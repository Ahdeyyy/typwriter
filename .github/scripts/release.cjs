const { Buffer } = require('node:buffer');

async function prepareRelease({ github, context, version, mobileVersion }) {
  if (version !== mobileVersion) {
    throw new Error(`Desktop (${version}) and Android (${mobileVersion}) versions differ`);
  }
  const tag = `typwriter-v${version}`;
  // Tag lookup alone cannot reliably find unpublished drafts.
  const releases = await github.paginate(github.rest.repos.listReleases, context.repo);
  const matches = releases.filter(release => release.tag_name === tag);
  if (matches.length > 1) {
    throw new Error(`Multiple releases exist for ${tag}; consolidate them before publishing`);
  }
  if (matches.length) return matches[0];
  const { data } = await github.rest.repos.createRelease({
    ...context.repo,
    tag_name: tag,
    target_commitish: context.sha,
    name: `typwriter v${version}`,
    body: `${version} Release`,
    draft: true,
    prerelease: false,
  });
  return data;
}

async function uploadAsset({ github, context, releaseId, name, data }) {
  const repo = context.repo;
  const { data: release } = await github.rest.repos.getRelease({
    ...repo, release_id: releaseId,
  });
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, {
    ...repo, release_id: releaseId,
  });
  const existing = assets.find(asset => asset.name === name);
  // Stage the replacement before changing an existing download URL.
  const stagedName = existing ? `${name}.next` : name;
  const stale = assets.find(asset => asset.name === stagedName && asset !== existing);
  if (stale) {
    await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: stale.id });
  }
  const { data: uploaded } = await github.rest.repos.uploadReleaseAsset({
    ...repo,
    release_id: releaseId,
    url: release.upload_url,
    name: stagedName,
    data,
    headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
  });
  if (existing) {
    await github.rest.repos.updateReleaseAsset({
      ...repo, asset_id: existing.id, name: `${name}.previous-${existing.id}`,
    });
    try {
      await github.rest.repos.updateReleaseAsset({ ...repo, asset_id: uploaded.id, name });
    } catch (error) {
      await github.rest.repos.updateReleaseAsset({ ...repo, asset_id: existing.id, name });
      throw error;
    }
    await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: existing.id });
  }
}

// `targets` pairs each updater target with its bundles, default format first.
async function buildManifest({ repo, tag, version, notes, targets, readSignature }) {
  const manifest = { version, notes, pub_date: new Date().toISOString(), platforms: {} };
  for (const [target, bundles] of targets) {
    for (const [index, [bundle, name]] of bundles.entries()) {
      const signature = (await readSignature(name)).trim();
      if (!signature) throw new Error(`Empty updater signature for ${name}`);
      const entry = {
        signature,
        url: `https://github.com/${repo.owner}/${repo.repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
      };
      if (index === 0) manifest.platforms[target] = entry;
      manifest.platforms[`${target}-${bundle}`] = entry;
    }
  }
  return manifest;
}

// The Android app's update check (no Tauri updater on mobile): it compares
// `version` with its own and sends the user to `url` to install over itself.
function androidManifest({ repo, tag, version, notes, apk }) {
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    url: `https://github.com/${repo.owner}/${repo.repo}/releases/download/${tag}/${encodeURIComponent(apk)}`,
  };
}

const manifestData = manifest => Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

async function publishUpdater({ github, context, releaseId, version }) {
  const repo = context.repo;
  const { data: release } = await github.rest.repos.getRelease({
    ...repo, release_id: releaseId,
  });
  const tag = `typwriter-v${version}`;
  if (release.tag_name !== tag) throw new Error(`Expected release tag ${tag}`);
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, {
    ...repo, release_id: releaseId,
  });
  const byName = new Map(assets.map(asset => [asset.name, asset]));
  const installers = [
    `Typwriter_${version}_aarch64.dmg`,
    `Typwriter_${version}_x64.dmg`,
    `typwriter_mobile_${version}_arm64.apk`,
  ];
  // The first bundle for each target is its default updater format, matching
  // tauri-action (AppImage on Linux, MSI on Windows).
  const targets = [
    ['darwin-aarch64', [['app', 'Typwriter_aarch64.app.tar.gz']]],
    ['darwin-x86_64', [['app', 'Typwriter_x64.app.tar.gz']]],
    ['linux-x86_64', [
      ['appimage', `Typwriter_${version}_amd64.AppImage`],
      ['deb', `Typwriter_${version}_amd64.deb`],
      ['rpm', `Typwriter-${version}-1.x86_64.rpm`],
    ]],
    ['windows-x86_64', [
      ['msi', `Typwriter_${version}_x64_en-US.msi`],
      ['nsis', `Typwriter_${version}_x64-setup.exe`],
    ]],
  ];
  const required = installers.concat(
    targets.flatMap(([, bundles]) => bundles.flatMap(([, name]) => [name, `${name}.sig`])),
  );
  const missing = required.filter(name => !byName.has(name) || !byName.get(name).size);
  if (missing.length) throw new Error(`Missing release assets: ${missing.join(', ')}`);

  const manifest = await buildManifest({
    repo, tag, version, targets,
    notes: release.body || `${version} Release`,
    readSignature: async name => {
      const { data } = await github.rest.repos.getReleaseAsset({
        ...repo,
        asset_id: byName.get(`${name}.sig`).id,
        headers: { accept: 'application/octet-stream' },
      });
      return Buffer.from(data).toString('utf8');
    },
  });
  await uploadAsset({
    github, context, releaseId, name: 'latest.json', data: manifestData(manifest),
  });
  await uploadAsset({
    github, context, releaseId, name: 'android.json',
    data: manifestData(androidManifest({
      repo, tag, version, notes: manifest.notes, apk: `typwriter_mobile_${version}_arm64.apk`,
    })),
  });
  return manifest;
}

module.exports = {
  androidManifest, buildManifest, manifestData, prepareRelease, publishUpdater, uploadAsset,
};
