# Contributing to Joinery

Thank you for your interest in contributing to Joinery! This document provides guidelines and information for contributors.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/joinery-labs/joinery.git
   cd joinery
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start the development server**:
   ```bash
   npm run dev
   ```

## Development Guidelines

### Code Style

- Use **ES Modules** (`import`/`export`)
- Follow the existing file structure and naming conventions
- Use **JSDoc comments** for public functions
- Keep functions focused and single-purpose
- Use meaningful variable and function names

### Project Structure

- `src/js/core/` — Database engine, event bus, keyboard shortcuts
- `src/js/editor/` — Monaco editor integration and SQL IntelliSense
- `src/js/features/` — Feature modules (query editor, results, file upload, table manager, export/import)
- `src/js/platform/` — Web vs. Tauri platform abstraction
- `src/js/ui/` — UI components (modals, notifications, templates, theme)
- `src/js/utils/` — Helper functions (SQL utilities, type inference, date parsing)
- `src/css/` — Modular CSS (base tokens, components, features, layout)

### CSS Guidelines

- Use CSS custom properties (variables) from `base/_tokens.css`
- Follow the BEM-like naming convention
- Add new styles to the appropriate CSS partial file
- Avoid inline styles in JavaScript

## Submitting Changes

### Pull Request Process

1. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and commit with clear messages:
   ```bash
   git commit -m "Add feature: description of what you added"
   ```

3. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Open a Pull Request** on GitHub with:
   - A clear title describing the change
   - A description of what was changed and why
   - Any relevant issue numbers

### Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Keep the first line under 72 characters
- Reference issues when applicable

## Reporting Issues

When reporting bugs, please include:

- **Description**: What happened vs. what you expected
- **Steps to reproduce**: How to trigger the issue
- **Environment**: Browser/OS version
- **Screenshots**: If relevant to the issue

## Feature Requests

Feature requests are welcome! Please:

- Check existing issues to avoid duplicates
- Describe the use case and expected behavior
- Explain why this feature would be useful

## Questions?

Feel free to open an issue for any questions about contributing.

---

Thank you for contributing! 🙏