// One tiny argument parser, shared by the CLI and by `wrap`.
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
        else { flags[a.slice(2)] = next; i++; }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
