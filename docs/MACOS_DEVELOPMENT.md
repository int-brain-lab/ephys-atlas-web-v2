# macOS development handoff

This is the clean-checkout contract for continuing development on Apple
silicon. Repository state comes from `origin/main`; private credentials and
large scientific inputs remain outside Git.

## One-time prerequisites

Install the Apple command-line tools and Homebrew, then install the committed
toolchain majors:

```bash
xcode-select --install
brew install node@22 uv just
```

Homebrew's `node@22` is keg-only. Ensure new login shells can find it:

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile
exec zsh -l
```

Verify the environment before cloning:

```bash
node --version
uv --version
just --version
git --version
```

Node must report major version 22. The repository's `.node-version`, npm
engine constraint, Python `uv.lock` files, and npm lockfile own project
versions; do not install project dependencies with system `pip`.

## Checkout and bootstrap

HTTPS cloning needs no GitHub SSH key for a public checkout:

```bash
mkdir -p ~/GIT/IBL
cd ~/GIT/IBL
git clone https://github.com/int-brain-lab/ephys-atlas-web-v2.git
cd ephys-atlas-web-v2
git switch main
git pull --ff-only origin main
just bootstrap
just check
```

Configure GitHub authentication separately before the first push from this
machine. Do not copy another machine's private SSH key. Either add a new Mac
SSH key to GitHub or use an approved HTTPS credential helper.

Launch Codex from the repository root. Its first instruction should be:

> Read AGENTS.md and every required start document. Follow
> docs/data/VOLUME_IMPLEMENTATION_HANDOFF.md, verify the Mac bootstrap, acquire
> and checksum the required W26 source through the documented official path,
> and continue the next unblocked production-volume slice. Commit coherent
> green changes on main. Do not resume voxel-derived 3-D mesh generation.

## Private scientific data

A clean checkout and `just check` require no private data. Real W26 work uses
the official ONE/IBL authentication configured outside this repository:

```bash
just data-pull-volume 2026_W26 50
```

The command must produce the exact object identity recorded in
`docs/data/VOLUME_IMPLEMENTATION_HANDOFF.md`. If authentication is unavailable,
the agent must report that exact blocker; it must not copy credentials into Git,
invent a source, or substitute a different vintage.

Generated releases, benchmarks, and review pages remain ignored. Their source
identity, commands, and conclusions belong in tracked provenance/status docs.

## Switching machines safely

Finish and publish the handoff from the active machine before starting on the
other one:

```bash
just check
git status
git push origin main
```

Then begin on the other machine with:

```bash
git status
git pull --ff-only origin main
just check
```

Do not develop concurrently in two unpushed `main` worktrees. Never discard
unexpected local changes to make a pull succeed.


## Refresh documentation screenshots from macOS

Canonical documentation pixels are generated on Linux. After pushing reviewed
UI changes, run the **Documentation screenshots** GitHub Actions workflow on
`main`. It renders the canonical synthetic fixture, regenerates screenshots,
then runs the pixel comparisons again. Download its `documentation-screenshots`
artifact from the successful run for that exact commit, inspect the image diffs,
and copy only intended changes into `docs/assets/generated/` before committing.
The workflow has read-only repository access and never commits or publishes data.
