const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prepareRelease, publishUpdater, uploadAsset } = require('./release.cjs');

const context = { repo: { owner: 'example', repo: 'typwriter' }, sha: 'release-commit' };
const version = '0.9.3';
const release = {
  id: 42, tag_name: `typwriter-v${version}`, draft: true,
  upload_url: 'https://uploads.github.com/example', body: 'Release notes',
};

function fixture({ releases = [], names = [], failUpload = false, failPromotion = false } = {}) {
  const calls = [];
  const assets = names.map((name, i) => ({ id: i + 1, name, size: 100 }));
  const repos = Object.fromEntries([
    'listReleases', 'listReleaseAssets', 'createRelease', 'getRelease',
    'getReleaseAsset', 'uploadReleaseAsset', 'updateReleaseAsset', 'deleteReleaseAsset',
  ].map(name => [name, async args => {
    calls.push([name, args]);
    if (name === 'getRelease' || name === 'createRelease') return { data: release };
    if (name === 'getReleaseAsset') {
      const asset = assets.find(asset => asset.id === args.asset_id);
      return { data: Buffer.from(`signature:${asset.name}\n`) };
    }
    if (name === 'uploadReleaseAsset') {
      if (failUpload) throw new Error('Upload failed');
      return { data: { id: 999 } };
    }
    if (name === 'updateReleaseAsset' && args.asset_id === 999 && failPromotion) {
      throw new Error('Promotion failed');
    }
    return { data: {} };
  }]));
  const github = {
    rest: { repos },
    paginate: async method => method === repos.listReleases ? releases : assets,
  };
  return { github, calls };
}

test('prepare creates one draft at the release commit and reuses published or draft releases', async () => {
  const { github, calls } = fixture();
  await prepareRelease({ github, context, version, mobileVersion: version });
  assert.deepEqual(calls[0], ['createRelease', {
    ...context.repo, tag_name: release.tag_name, target_commitish: context.sha,
    name: `typwriter v${version}`, body: `${version} Release`, draft: true, prerelease: false,
  }]);
  for (const draft of [true, false]) {
    const existing = { ...release, draft };
    const f = fixture({ releases: [existing] });
    assert.equal(await prepareRelease({ github: f.github, context, version, mobileVersion: version }), existing);
    assert.equal(f.calls.length, 0);
  }
});

test('prepare refuses duplicate releases and mismatched mobile versions before uploading', async () => {
  const { github, calls } = fixture({ releases: [release, { ...release, id: 43 }] });
  await assert.rejects(prepareRelease({ github, context, version, mobileVersion: version }), /Multiple releases/);
  await assert.rejects(prepareRelease({ github, context, version, mobileVersion: '0.1.0' }), /versions differ/);
  assert.equal(calls.length, 0);
});

const bundleNames = [
  'Typwriter_aarch64.app.tar.gz', 'Typwriter_x64.app.tar.gz',
  `Typwriter_${version}_amd64.AppImage`, `Typwriter_${version}_amd64.deb`,
  `Typwriter-${version}-1.x86_64.rpm`, `Typwriter_${version}_x64_en-US.msi`,
  `Typwriter_${version}_x64-setup.exe`,
];
const allNames = [
  `Typwriter_${version}_aarch64.dmg`, `Typwriter_${version}_x64.dmg`,
  `typwriter_mobile_${version}_arm64.apk`,
  ...bundleNames.flatMap(name => [name, `${name}.sig`]),
];

test('finalizer creates all updater entries from uploaded signatures with stable tag URLs', async () => {
  const { github, calls } = fixture({ names: [...allNames, 'latest.json'] });
  const manifest = await publishUpdater({ github, context, releaseId: release.id, version });
  assert.equal(Object.keys(manifest.platforms).length, 11);
  assert.equal(manifest.notes, 'Release notes');
  for (const [target, entry] of Object.entries(manifest.platforms)) {
    const name = decodeURIComponent(entry.url.split('/').pop());
    assert.equal(entry.signature, `signature:${name}.sig`);
    assert.equal(entry.url, `https://github.com/example/typwriter/releases/download/${release.tag_name}/${name}`);
    assert(bundleNames.includes(name), target);
  }
  assert.equal(manifest.platforms['windows-x86_64'].url, manifest.platforms['windows-x86_64-msi'].url);
  assert.equal(manifest.platforms['linux-x86_64'].url, manifest.platforms['linux-x86_64-appimage'].url);
  const writes = calls.filter(([name]) => /upload|update|delete/.test(name));
  assert.deepEqual(writes.map(([name]) => name), [
    'uploadReleaseAsset', 'updateReleaseAsset', 'updateReleaseAsset', 'deleteReleaseAsset',
  ]);
  assert.equal(writes[0][1].release_id, release.id);
  assert.equal(writes[0][1].name, 'latest.json.next');
  assert.deepEqual(JSON.parse(writes[0][1].data), manifest);
  assert.equal(writes[2][1].name, 'latest.json');
});

test('finalizer leaves existing updater intact when an installer or signature is missing', async () => {
  for (const missing of [`typwriter_mobile_${version}_arm64.apk`, `${bundleNames[0]}.sig`]) {
    const { github, calls } = fixture({ names: allNames.filter(name => name !== missing) });
    await assert.rejects(publishUpdater({ github, context, releaseId: release.id, version }), /Missing release assets/);
    assert(!calls.some(([name]) => /upload|update|delete/.test(name)));
  }
});

test('finalizer refuses to write updater metadata to another release version', async () => {
  const { github, calls } = fixture({ names: allNames });
  await assert.rejects(publishUpdater({ github, context, releaseId: release.id, version: '9.9.9' }), /Expected release tag/);
  assert(!calls.some(([name]) => /upload|update|delete/.test(name)));
});

test('a failed replacement upload preserves the current download', async () => {
  const { github, calls } = fixture({ names: ['latest.json'], failUpload: true });
  await assert.rejects(uploadAsset({
    github, context, releaseId: release.id, name: 'latest.json', data: Buffer.from('{}'),
  }), /Upload failed/);
  assert(!calls.some(([name]) => name === 'deleteReleaseAsset'));
});

test('a failed promotion restores the previous asset name', async () => {
  const { github, calls } = fixture({ names: ['latest.json'], failPromotion: true });
  await assert.rejects(uploadAsset({
    github, context, releaseId: release.id, name: 'latest.json', data: Buffer.from('{}'),
  }), /Promotion failed/);
  assert(!calls.some(([name]) => name === 'deleteReleaseAsset'));
  const updates = calls.filter(([name]) => name === 'updateReleaseAsset');
  assert.equal(updates[0][1].name, 'latest.json.previous-1');
  assert.equal(updates[2][1].asset_id, 1);
  assert.equal(updates[2][1].name, 'latest.json');
});
