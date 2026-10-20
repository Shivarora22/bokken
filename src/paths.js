import os from 'node:os';
import path from 'node:path';

export function getPaths(env = process.env) {
  const home = env.BOKKEN_HOME ? path.resolve(env.BOKKEN_HOME) : path.join(os.homedir(), '.bokken');
  return {
    home,
    config: path.join(home, 'config.json'),
    credentials: path.join(home, 'credentials.json'),
    db: path.join(home, 'bokken.db'),
  };
}

export function defaultWorkspace() {
  return path.join(os.homedir(), 'leetcode-solutions');
}
