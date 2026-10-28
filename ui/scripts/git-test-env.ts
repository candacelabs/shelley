const gitEnvironment = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
} as const;

const strippedGitVariables = new Set([
  'EMAIL',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_AUTHOR_DATE',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_NAME',
  'GIT_COMMITTER_DATE',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMON_DIR',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_TEMPLATE_DIR',
  'GIT_WORK_TREE',
]);

function shouldStrip(name: string): boolean {
  return (
    strippedGitVariables.has(name) ||
    name.startsWith('GIT_CONFIG_KEY_') ||
    name.startsWith('GIT_CONFIG_VALUE_')
  );
}

export function hermeticGitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const name of Object.keys(result)) {
    if (shouldStrip(name)) delete result[name];
  }
  return { ...result, ...gitEnvironment };
}

export function installHermeticGitEnvironment(): () => void {
  const managedNames = Object.keys(process.env).filter(
    (name) => shouldStrip(name) || name in gitEnvironment,
  );
  const previous = Object.fromEntries(managedNames.map((name) => [name, process.env[name]]));
  for (const name of managedNames) delete process.env[name];
  Object.assign(process.env, gitEnvironment);
  return () => {
    for (const name of Object.keys(process.env)) {
      if (shouldStrip(name) || name in gitEnvironment) delete process.env[name];
    }
    for (const [name, value] of Object.entries(previous)) {
      if (value !== undefined) process.env[name] = value;
    }
  };
}
