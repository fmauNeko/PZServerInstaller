#!/usr/bin/env node

import glob from 'glob';
import got from 'got'; // eslint-disable-line import/no-unresolved
import ini from 'ini';
import { SteamCmd } from 'steamcmd-interface';
import toml from 'toml';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const rawConfig = await fsPromises.readFile(path.join(process.cwd(), 'config.toml'), 'utf-8');
const config = toml.parse(rawConfig);

const steamCmd = await SteamCmd.init({
  binDir: config.steamcmdPath,
  installDir: config.serverPath,
});

console.log('Installing / updading game server');

for await (const progress of steamCmd.updateApp(380870, { validate: true })) {
  console.log(`${progress.state} ${progress.progressPercent}%`);
}

console.log('Installing / updading Workshop mods');

const [workshopIds, collectionIds] = config.workshop.reduce(([w, c], val) => {
  if (val.type === 'file') return [[...w, val.id], c];
  if (val.type === 'collection') return [w, [...c, val.id]];
  return [w, c];
}, [[], []]);

const resolvedCollections = await got.post('https://community.steam-api.com/ISteamRemoteStorage/GetCollectionDetails/v1/', {
  form: {
    collectioncount: collectionIds.length,
    ...collectionIds.reduce((o, val, idx) => ({
      ...o,
      [`publishedfileids[${idx}]`]: val,
    }), {}),
  },
}).json();

const allWorkshopIds = [
  ...workshopIds,
  ...resolvedCollections.response.collectiondetails.reduce(
    (acc, val) => [...acc, ...val.children.map((c) => c.publishedfileid)],
    [],
  ),
];

const commands = allWorkshopIds.map((i) => `workshop_download_item 108600 ${i} validate`);

for await (const line of steamCmd.run(commands)) {
  console.log(line);
}

const serverDataPath = path.join(os.homedir(), 'Zomboid');

try {
  fsPromises.stat(serverDataPath);
} catch {
  console.error(`
    ${serverDataPath} doesn't exist.
    Please start the server for the first time using ${path.join(config.serverPath, 'start-server.sh')} then quit it and rerun this script.
  `);
  process.exit(1);
}

const modsPath = path.join(serverDataPath, 'Mods');

try {
  fsPromises.lstat(modsPath);
} catch {
  console.log(`
    ${path.join(serverDataPath, 'Mods')} doesn't exist.
    Creating a link from the workshop folder...
  `);

  const workshopModsPath = path.join(os.homedir(), 'Steam', 'steanapps', 'workshop', 'content', '108600');
  try {
    await fsPromises.link(workshopModsPath, modsPath);
  } catch (err) {
    console.error(`
      Unable to create link ${workshopModsPath} -> ${modsPath}.
      Reported error: ${err}.
    `);
    process.exit(1);
  }
}

const modInfoPaths = glob.sync(path.join(modsPath, '**', 'mod.info'));

const modLoadIds = modInfoPaths.map((p) => {
  const modInfo = ini.parse(fs.readFileSync(p));
  return modInfo.id;
});

const serverConfigPath = path.join(serverDataPath, 'Server', 'servertest.ini');

let serverConfig = '';

try {
  serverConfig = await fsPromises.readFile(serverConfigPath);
} catch {
  console.error(`Cannot read ${serverConfigPath}`);
  process.exit(1);
}

const parsedServerConfig = ini.parse(serverConfig);

parsedServerConfig.WorkshopItems = allWorkshopIds.join(';');
parsedServerConfig.Mods = modLoadIds.join(';');

await fsPromises.writeFile(serverConfigPath, ini.stringify(parsedServerConfig));
