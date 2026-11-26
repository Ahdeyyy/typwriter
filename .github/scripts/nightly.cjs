const fs = require('node:fs');
const path = require('node:path');
const { androidManifest, buildManifest, manifestData, uploadAsset } = require('./release.cjs');

// Nightly builds are separate apps (own identifier, name, icon and updater
// endpoint, from each app's tauri.nightly.conf.json) published to one rolling
// prerelease, so they install alongside stable and never touch its release.
const TAG = 'nightly';
const DESKTOP_PREFIX = 'Typwriter-Nightly';
const MOBILE_PREFIX = 'typwriter_mobile_nightly';

// A prerelease of the next patch: sorts above the current stable, so the
// updater accepts it, and below the release it leads up to.
function nightlyVersion(version, runNumber) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a plain x.y.z stable version, got ${version}`);
  if (!Number.isInteger(runNumber) || runNumber < 1) {
    throw new Error(`Expected a positive run number, got ${runNumber}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}-nightly.${runNumber}`;
}

// The `--config` overlay for one build. Android only installs over the previous
// nightly if versionCode grows, and the semver-derived one ignores the
// prerelease part, so it comes from the run number. Desktop ignores it.
function nightlyConfig(overlay, version, runNumber) {
  const bundle = overlay.bundle ?? {};
  return {
    ...overlay,
    version,
    bundle: { ...bundle, android: { ...bundle.android, versionCode: runNumber } },
  };
}

// Tauri names bundles after the product name, and GitHub rewrites the space in
// "Typwriter Nightly", so desktop bundles are renamed to names the finalizer
// can predict. `.app.tar.gz` must be matched before anything shorter.
const DESKTOP_BUNDLES = [
  ['.app.tar.gz', arch => `_${arch}.app.tar.gz`],
  ['.dmg', arch => `_${arch}.dmg`],
  ['-setup.exe', arch => `_${arch}-setup.exe`],
  ['.AppImage', () => '_amd64.AppImage'],
  ['.deb', () => '_amd64.deb'],
  ['.rpm', () => '_x86_64.rpm'],
];

function collectDesktop({ bundleDir, outDir, version, arch }) {
  fs.mkdirSync(outDir, { recursive: true });
  const collected = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      // .app and .AppDir are the unpacked bundles the archives were made from.
      if (entry.isDirectory()) {
        if (!/\.(app|AppDir)$/.test(entry.name)) walk(file);
        continue;
      }
      const signed = entry.name.endsWith('.sig');
      const base = signed ? entry.name.slice(0, -4) : entry.name;
      const bundle = DESKTOP_BUNDLES.find(([suffix]) => base.endsWith(suffix));
      if (!bundle) continue;
      const name = `${DESKTOP_PREFIX}_${version}${bundle[1](arch)}${signed ? '.sig' : ''}`;
      if (collected.includes(name)) throw new Error(`Two bundles map to ${name}`);
      fs.copyFileSync(file, path.join(outDir, name));
      collected.push(name);
    }
  };
  walk(bundleDir);
  if (!collected.length) throw new Error(`No desktop bundles found in ${bundleDir}`);
  return collected;
}

function nightlyAssets(version) {
  const desktop = `${DESKTOP_PREFIX}_${version}`;
  // Windows ships NSIS only: MSI cannot carry a prerelease version.
  const targets = [
    ['darwin-aarch64', [['app', `${desktop}_aarch64.app.tar.gz`]]],
    ['darwin-x86_64', [['app', `${desktop}_x64.app.tar.gz`]]],
    ['linux-x86_64', [
      ['appimage', `${desktop}_amd64.AppImage`],
      ['deb', `${desktop}_amd64.deb`],
      ['rpm', `${desktop}_x86_64.rpm`],
    ]],
    ['windows-x86_64', [['nsis', `${desktop}_x64-setup.exe`]]],
  ];
  const installers = [
    `${desktop}_aarch64.dmg`,
    `${desktop}_x64.dmg`,
    `${MOBILE_PREFIX}_${version}_arm64.apk`,
  ];
  const required = installers.concat(
    targets.flatMap(([, bundles]) => bundles.flatMap(([, name]) => [name, `${name}.sig`])),
  );
  return { targets, required };
}

// Point the rolling release at this build's commit, creating it on first use.
// Moving the tag is cosmetic (downloads resolve by tag name, not commit), and
// the token may be refused for commits that change workflows, so a failure
// only warns.
async function moveNightly({ github, context, name, body, warn }) {
  const repo = context.repo;
  let release = null;
  try {
    ({ data: release } = await github.rest.repos.getReleaseByTag({ ...repo, tag: TAG }));
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (!release) {
    const { data } = await github.rest.repos.createRelease({
      ...repo, tag_name: TAG, target_commitish: context.sha, name, body,
      prerelease: true, make_latest: 'false',
    });
    return data;
  }
  try {
    await github.rest.git.updateRef({ ...repo, ref: `tags/${TAG}`, sha: context.sha, force: true });
  } catch (error) {
    warn(`Could not move the ${TAG} tag to ${context.sha}: ${error.message}`);
  }
  const { data } = await github.rest.repos.updateRelease({
    ...repo, release_id: release.id, name, body,
    draft: false, prerelease: true, make_latest: 'false',
  });
  return data;
}

async function publishNightly({ github, context, version, dir, warn = () => {} }) {
  const repo = context.repo;
  const files = fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile());
  const { targets, required } = nightlyAssets(version);
  const missing = required.filter(
    name => !files.includes(name) || !fs.statSync(path.join(dir, name)).size,
  );
  if (missing.length) throw new Error(`Missing nightly assets: ${missing.join(', ')}`);

  const body = `Rolling nightly build of ${context.sha}. Installs alongside the ` +
    'stable app as "Typwriter Nightly" and updates itself from this release.';
  const release = await moveNightly({
    github, context, name: `Nightly ${version}`, body, warn,
  });
  // Installed nightlies keep reading the previous latest.json/android.json,
  // whose assets stay up until the end: upload this build, then switch the
  // manifests over, then prune.
  for (const name of files) {
    await uploadAsset({
      github, context, releaseId: release.id, name,
      data: fs.readFileSync(path.join(dir, name)),
    });
  }
  const manifest = await buildManifest({
    repo, tag: TAG, version, targets, notes: body,
    readSignature: async name => fs.readFileSync(path.join(dir, `${name}.sig`), 'utf8'),
  });
  await uploadAsset({
    github, context, releaseId: release.id, name: 'latest.json', data: manifestData(manifest),
  });
  await uploadAsset({
    github, context, releaseId: release.id, name: 'android.json',
    data: manifestData(androidManifest({
      repo, tag: TAG, version, notes: body, apk: `${MOBILE_PREFIX}_${version}_arm64.apk`,
    })),
  });
  const keep = new Set([...files, 'latest.json', 'android.json']);
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, {
    ...repo, release_id: release.id,
  });
  for (const asset of assets) {
    if (!keep.has(asset.name)) {
      await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: asset.id });
    }
  }
  return manifest;
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// CLI for the workflows:
//   version <run-number>                                  → prints the version
//   config <app-dir> <version> <run-number> <out-file>    → writes the overlay
//   collect <bundle-dir> <out-dir> <version> <arch>       → renames bundles
function main([command, ...args]) {
  const root = path.resolve(__dirname, '../..');
  if (command === 'version') {
    const desktop = readJson(path.join(root, 'apps/typwriter-desktop/src-tauri/tauri.conf.json'));
    const mobile = readJson(path.join(root, 'apps/typwriter-mobile/src-tauri/tauri.conf.json'));
    if (desktop.version !== mobile.version) {
      throw new Error(`Desktop (${desktop.version}) and Android (${mobile.version}) versions differ`);
    }
    console.log(nightlyVersion(desktop.version, Number(args[0])));
  } else if (command === 'config') {
    const [appDir, version, runNumber, outFile] = args;
    const overlay = readJson(path.join(appDir, 'src-tauri/tauri.nightly.conf.json'));
    const config = nightlyConfig(overlay, version, Number(runNumber));
    fs.writeFileSync(outFile, `${JSON.stringify(config, null, 2)}\n`);
  } else if (command === 'collect') {
    const [bundleDir, outDir, version, arch] = args;
    for (const name of collectDesktop({ bundleDir, outDir, version, arch })) console.log(name);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  collectDesktop, nightlyAssets, nightlyConfig, nightlyVersion, publishNightly,
};
