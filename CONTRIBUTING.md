# Contributing

Thanks for helping improve Integrated Task Manager. Bug reports, ideas and pull requests are all welcome on GitHub.

## Reporting a bug

Open an issue with:

- what you did, what you expected, and what happened instead;
- the task lines involved, as written in your note (with anything private changed);
- your Obsidian version, platform (desktop or mobile), and the plugin's version.

## Working on the code

You need Node.js 18 or newer.

```bash
npm install
```

- `npm run dev` rebuilds `main.js` as you edit. Clone the repository into a test vault's `.obsidian/plugins/integrated-task-manager/` folder, then reload Obsidian to pick up changes.
- `npm test` runs the test suite (Vitest).
- `npm run build` type-checks and makes the production `main.js`.

The source is TypeScript in `src/`, with styles in `styles.css`. Tasks stay plain Markdown: the plugin reads and writes the notes they live in, and anything it writes must still read well as Markdown.

## Pull requests

- Keep each pull request to one change, and add or update tests for what it changes.
- Run `npm test` and `npm run build` before you push. `main.js` is committed, built in production mode, so commit it with your change.
- Update `README.md` when a change affects what users see or do.
- Use Obsidian's helpers (`createEl`, `createDiv`, `setCssStyles`, `setCssProps`) rather than building or styling elements by hand, and prefer CSS classes over inline styles.
