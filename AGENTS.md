# Project Instructions

## After making changes

Always run lint and format checks after each task, before presenting work for review:

```sh
npm run lint
npm run format:check
```

Fix any issues before moving on. Use npm run lint:fix and npm run format to auto-fix.

## Committing (gitleaks pre-commit hook)

The husky `pre-commit` hook runs a gitleaks secret scan (see the README's
"Pre-commit secret scan"). `npm install` wires the hook, but gitleaks is a
standalone binary that is deliberately not an npm dependency, so it is absent
on fresh clones, CI runners, and cloud agent containers.

Always start by presuming gitleaks is available on `PATH`: the pre-commit scan
should run and pass for secret-free changes. If it is absent the hook prints
"gitleaks not found in PATH" and exits non-zero; that is expected, not a failure
to investigate, so don't install gitleaks, debug husky, or retry. Bypass it instead:

```sh
git commit --no-verify -m "..."
```

GitHub's server-side secret scanning and push protection are the backstop once
the branch is pushed, so skipping the local scan is safe for secret-free
changes. If you are committing something that might be a secret, stop and flag
it rather than bypassing.

**IMPORTANT**: gitleaks is unique in its optionality. There are no other analyser tools
that can be bypassed.

## Build system

Use npx nx to run build/test scripts — this is an nx monorepo.

## Installing dependencies (npm 11)

**Install with npm 11** (`npm install -g npm@11`). Node 22 ships npm 10, and the
two disagree on the lockfile. Ours is generated under npm 11, which records a
`libc` field on platform-specific optional binaries (14 of them, across nx,
rolldown and lightningcss). npm 10 does not know that field, so a plain
`npm install` on npm 10 silently rewrites `package-lock.json` to strip all 14.

Neither the field nor the rewrite is a defect, and the rewrite does not want
committing. Under npm 11 the same `npm install` is a no-op, which is the
tell that the lockfile is already correct. CI pins npm 11 before every
`npm ci` for the same reason (see the `Pin npm` steps in
[pr.yml](.github/workflows/pr.yml) and [deploy.yml](.github/workflows/deploy.yml)).

So if `libc` blocks are disappearing from your `package-lock.json` diff, that is
npm 10 talking. Restore the file (`git checkout package-lock.json`), pin npm,
and install again.

## Voice & copy

Site copy is short, witty, and irreverent, Edinburgh-proud, and leans on
classic-song references (landing-page sections are headed with song titles).

- Avoid em-dashes in prose. Use full stops, commas, or parentheses.
  (Conventional title/aria-label separators are fine.)
- Lead with what makes UkeHoot different: a flat collective with no leader
  and no agenda; people turn up, contribute, and the joy follows.
- Reinforce the longevity (since 2012) and resilience (venue moves, a
  pandemic, festivals, constant churn), and the volunteer-driven spirit.
- Beginner training is informal, volunteer-run, and ad-hoc, not scheduled.
