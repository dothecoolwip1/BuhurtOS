// Claude Code reads .claude/skills and Codex reads .agents/skills (docs/SKILLS.md). Both must hold the same skills, byte for byte.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
const tree = (dir: string) => Object.fromEntries(files(dir).map(f => [relative(dir, f).split('\\').join('/'), readFileSync(f).toString('base64')]));

describe('agent skills', () => {
  it('.claude/skills and .agents/skills are identical', () => {
    expect(tree(join(root, '.claude', 'skills'))).toEqual(tree(join(root, '.agents', 'skills')));
  });
  it('every skill named in skills-lock.json is installed, and the rehearsal skill is present', () => {
    const lock = JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8')) as { skills: Record<string, unknown> };
    const installed = readdirSync(join(root, '.agents', 'skills'));
    for (const name of [...Object.keys(lock.skills), 'buhurtos-rehearsal']) expect(installed).toContain(name);
  });
});
