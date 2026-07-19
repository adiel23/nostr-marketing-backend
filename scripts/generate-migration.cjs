const { spawnSync } = require('node:child_process');

const name = process.env.npm_config_name;

if (!name) {
  console.error(
    'Provide a migration name with: npm run migration:generate --name=Name',
  );
  process.exit(1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npmCommand,
  ['run', 'typeorm', '--', 'migration:generate', `./src/migrations/${name}`],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
