# Contributing to yt-transcript-kit

First off, thank you for considering contributing to `yt-transcript-kit`! It's people like you that make it a great tool for everyone.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct (standard contributor covenant).

## How Can I Contribute?

### Reporting Bugs

- Check the [issue tracker](https://github.com/Asm3r96/yt-transcript-kit/issues) to see if the bug has already been reported.
- If not, create a new issue. Include as much detail as possible:
    - A clear, descriptive title.
    - Steps to reproduce.
    - Expected behavior.
    - Actual behavior.
    - Your environment (Node.js version, OS, etc.).
    - Example YouTube URLs that trigger the issue.

### Suggesting Enhancements

- Check the [issue tracker](https://github.com/Asm3r96/yt-transcript-kit/issues) to see if the enhancement has already been suggested.
- If not, create a new issue and describe the feature you'd like to see, why it's useful, and how it should work.

### Pull Requests

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: `npm install`.
3. **Make your changes**. If you're adding a feature or fixing a bug, please add appropriate tests or update the smoke test.
4. **Ensure the code builds**: `npm run build`.
5. **Run type checks**: `npm run typecheck`.
6. **Smoke test**: Run `npm run smoke -- "YOUR_YOUTUBE_URL"` to verify it still works with real data.
7. **Submit a Pull Request**. Link any related issues in the description.

## Development Setup

The project uses TypeScript and aims for zero runtime dependencies (using built-in `fetch`).

- Node version: 18+
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Smoke test: `npm run smoke`

## Coding Style

- Use Prettier (default settings) for formatting.
- Write clear, commented code for complex logic (like XML parsing or JSON extraction).
- Use descriptive variable names.
- Ensure all new exports are properly typed.

## Discussion

For questions or general discussion, please use [GitHub Discussions](https://github.com/Asm3r96/yt-transcript-kit/discussions) if enabled, or open an issue with the "question" tag.
