const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  collectDesktop, nightlyAssets, nightlyConfig, nightlyVersion, publishNightly,
} = require('./nightly.cjs');

const context = { repo: { owner: 'example', repo: 'typwriter' }, sha: 'nightly-commit' };
const version = '0.9.4-nightly.12';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'typwriter-nightly-'));
}

test('nightly versions sort between the current stable and the next one', () => {
  assert.equal(nightlyVersion('0.9.3', 12), '0.9.4-nightly.12');
  assert.equal(nightlyVersion('1.0.9', 1), '1.0.10-nightly.1');
  assert.throws(() => nightlyVersion('0.9.3-beta.1', 12), /plain x\.y\.z/);
  assert.throws(() => nightlyVersion('0.9.3', Number.NaN), /run number/);
});

test('the overlay keeps the app overrides and adds the version and versionCode', () => {
  const overlay = {
    identifier: 'com.example.nightly',
    bundle: { icon: ['icons-nightly/icon.ico'], android: { minSdkVersion: 24 } },
  };
  assert.deepEqual(nightlyConfig(overlay, version, 12), {
    identifier: 'com.example.nightly',
    version,
    bundle: { icon: ['icons-nightly/icon.ico'], android: { minSdkVersion: 24, versionCode: 12 } },
  });
  assert.deepEqual(nightlyConfig({}, version, 3).bundle, { android: { versionCode: 3 } });
});

test('the committed overlays give each app its own identity', () => {
  const root = path.resolve(__dirname, '../..');
  for (const app of ['typwriter-desktop', 'typwriter-mobile']) {
    const dir = path.join(root, 'apps', app, 'src-tauri');
    const stable = JSON.parse(fs.readFileSync(path.join(dir, 'tauri.conf.json'), 'utf8'));
    const nightly = JSON.parse(fs.readFileSync(path.join(dir, 'tauri.nightly.conf.json'), 'utf8'));
    assert.notEqual(nightly.identifier, stable.identifier, app);
    assert.equal(nightly.productName, 'Typwriter Nightly', app);
    for (const icon of nightly.bundle?.icon ?? []) assert(fs.existsSync(path.join(dir, icon)), icon);
  }
});

test('desktop bundles are renamed to predictable asset names', () => {
  const bundleDir = tempDir();
  const outDir = tempDir();
  const files = {
    'macos/Typwriter Nightly.app.tar.gz': 'archive',
    'macos/Typwriter Nightly.app.tar.gz.sig': 'sig',
    'macos/Typwriter Nightly.app/Contents/Info.plist': 'plist',
    [`dmg/Typwriter Nightly_${version}_aarch64.dmg`]: 'dmg',
    'share/readme.txt': 'ignored',
  };
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(bundleDir, name)), { recursive: true });
    fs.writeFileSync(path.join(bundleDir, name), data);
  }
  const collected = collectDesktop({ bundleDir, outDir, version, arch: 'aarch64' });
  assert.deepEqual(collected.sort(), [
    `Typwriter-Nightly_${version}_aarch64.app.tar.gz`,
    `Typwriter-Nightly_${version}_aarch64.app.tar.gz.sig`,
    `Typwriter-Nightly_${version}_aarch64.dmg`,
  ]);
  assert.equal(fs.readFileSync(path.join(outDir, collected[0]), 'utf8'), 'archive');
});

function fixture({ release = { id: 7, upload_url: 'https://uploads.example' }, existing = [] } = {}) {
  const calls = [];
  let nextId = 100;
  const assets = existing.map((name, i) => ({ id: i + 1, name, size: 10 }));
  const call = (name, fn = () => ({})) => async args => {
    calls.push([name, args]);
    return { data: await fn(args) };
  };
  const repos = {
    getReleaseByTag: async args => {
      calls.push(['getReleaseByTag', args]);
      if (!release) throw Object.assign(new Error('Not Found'), { status: 404 });
      return { data: release };
    },
    createRelease: call('createRelease', () => ({ id: 8, upload_url: 'https://uploads.example' })),
    updateRelease: call('updateRelease', args => ({ id: args.release_id, upload_url: 'https://uploads.example' })),
    getRelease: call('getRelease', () => ({ upload_url: 'https://uploads.example' })),
    listReleaseAssets: () => {},
    uploadReleaseAsset: call('uploadReleaseAsset', args => {
      const asset = { id: nextId++, name: args.name, size: args.data.length };
      assets.push(asset);
      return asset;
    }),
    updateReleaseAsset: call('updateReleaseAsset', args => {
      assets.find(asset => asset.id === args.asset_id).name = args.name;
    }),
    deleteReleaseAsset: call('deleteReleaseAsset', args => {
      assets.splice(assets.findIndex(asset => asset.id === args.asset_id), 1);
    }),
  };
  const git = { updateRef: call('updateRef') };
  const github = { rest: { repos, git }, paginate: async () => assets.map(asset => ({ ...asset })) };
  return { github, calls, assets };
}

function stage(names) {
  const dir = tempDir();
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), name.endsWith('.sig') ? `signature:${name}\n` : 'bytes');
  }
  return dir;
}

test('publishing uploads the build, then the manifest, then prunes older builds', async () => {
  const { required } = nightlyAssets(version);
  const old = 'Typwriter-Nightly_0.9.4-nightly.11_x64-setup.exe';
  const { github, calls, assets } = fixture({ existing: [old, 'latest.json'] });
  const manifest = await publishNightly({ github, context, version, dir: stage(required) });

  assert.deepEqual(calls.find(([name]) => name === 'updateRef')[1], {
    ...context.repo, ref: 'tags/nightly', sha: context.sha, force: true,
  });
  const update = calls.find(([name]) => name === 'updateRelease')[1];
  assert.equal(update.prerelease, true);
  assert.equal(update.make_latest, 'false');

  assert.equal(Object.keys(manifest.platforms).length, 10);
  assert.equal(manifest.version, version);
  const exe = manifest.platforms['windows-x86_64'];
  assert.equal(exe, manifest.platforms['windows-x86_64-nsis']);
  assert.equal(exe.url, `https://github.com/example/typwriter/releases/download/nightly/Typwriter-Nightly_${version}_x64-setup.exe`);
  assert.equal(exe.signature, `signature:Typwriter-Nightly_${version}_x64-setup.exe.sig`);

  const uploads = calls.filter(([name]) => name === 'uploadReleaseAsset').map(([, args]) => args.name);
  assert.equal(uploads.at(-1), 'latest.json.next');
  const firstDelete = calls.findIndex(([name, args]) => name === 'deleteReleaseAsset' && args.asset_id === 1);
  assert(firstDelete > calls.findIndex(([, args]) => args?.name === 'latest.json.next'));
  assert.deepEqual(assets.map(asset => asset.name).sort(), [...required, 'latest.json'].sort());
});

test('the first nightly creates a prerelease that never becomes latest', async () => {
  const { github, calls } = fixture({ release: null });
  await publishNightly({ github, context, version, dir: stage(nightlyAssets(version).required) });
  const create = calls.find(([name]) => name === 'createRelease')[1];
  assert.equal(create.tag_name, 'nightly');
  assert.equal(create.prerelease, true);
  assert.equal(create.make_latest, 'false');
  assert(!calls.some(([name]) => name === 'updateRef'));
});

test('an incomplete build leaves the published nightly untouched', async () => {
  const required = nightlyAssets(version).required;
  for (const missing of [`typwriter_mobile_nightly_${version}_arm64.apk`, `Typwriter-Nightly_${version}_amd64.deb.sig`]) {
    const { github, calls } = fixture();
    await assert.rejects(
      publishNightly({ github, context, version, dir: stage(required.filter(name => name !== missing)) }),
      /Missing nightly assets/,
    );
    assert.equal(calls.length, 0);
  }
});

test('a refused tag move only warns', async () => {
  const { github } = fixture();
  github.rest.git.updateRef = async () => { throw new Error('workflows permission'); };
  const warnings = [];
  await publishNightly({
    github, context, version, dir: stage(nightlyAssets(version).required),
    warn: message => warnings.push(message),
  });
  assert.match(warnings[0], /workflows permission/);
});
