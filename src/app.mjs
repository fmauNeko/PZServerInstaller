#!/usr/bin/env node

import got from 'got'; // eslint-disable-line import/no-unresolved
import { SteamCmd } from 'steamcmd-interface';
import toml from 'toml';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rawConfig = await readFile(path.join(process.cwd(), 'config.toml'), 'utf-8');
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
