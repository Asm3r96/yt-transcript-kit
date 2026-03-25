# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `searchTranscript(...)` for case-sensitive/insensitive in-segment search with context windows.
- `chunkTranscript(...)` for char/token-based transcript chunking with overlap support.
- `formatTranscript(...)` with `segments`, `plainText`, `markdown`, and `paragraphs` modes.
- `getTranscriptWithMetadata(...)` helper that returns normalized transcript + metadata shape.
- Optional cache support in `fetchYouTubeTranscript(...)` via `cache`, plus `InMemoryTranscriptCache`.
- `fetchManyYouTubeTranscripts(...)` for concurrency-limited batch fetching with per-item typed failures.
- Cleanup helpers: `cleanTranscriptText(...)` and `cleanTranscriptSegments(...)`.
- Minimal CLI (`yt-transcript-kit`) with single fetch, search, chunking, and batch modes.

### Changed
- `fetchYouTubeTranscript(...)` now includes additional optional metadata fields when available (channel name, duration, and available language codes) without breaking existing response fields.

## [0.1.0] - 2024-03-15

### Added
- Initial release of `yt-transcript-kit`.
- Support for fetching YouTube transcripts via video ID or URL.
- Multi-language support with automatic fallback logic.
- Robust extraction using InnerTube API and HTML parsing.
- Zero runtime dependencies (uses native `fetch`).
- Strictly typed error handling.
- Support for Node.js (18+), React Native, and Browser Extensions.
- Created comprehensive documentation: README, CONTRIBUTING, ARCHITECTURE, and SECURITY.
