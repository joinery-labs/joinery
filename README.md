# Joinery

Privacy-first local data analytics powered by DuckDB. Run SQL queries on your files instantly in your browser or desktop app with an intuitive interface.

## 🎯 Why Joinery?

**SQL excels at certain data transformations.** For tasks like pivoting, unpivoting, complex filtering, and sophisticated aggregations, SQL, especially DuckDB, provides built-in functions that are often faster to write, easier to modify, and more reproducible than clicking through Excel menus.

**Modern AI has made SQL accessible to everyone.** Copy your database schema from Joinery, describe what you need in plain English to LLMs like Gemini, Claude, or ChatGPT, and get working queries back. SQL's readable syntax makes validation straightforward. You can see exactly what's happening to your data. Best part? LLMs can understand what data they're dealing with from the schema and sample data, so in most cases you won't need to explain much.

**Sometimes you need transparency over automation.** While AI agent frameworks are powerful tools for complex workflows, they also abstract away the details. When you need to understand and verify each step of your data processing, a direct SQL approach gives you full visibility and control.

**Here's a practical difference.** When you ask an AI for help with a spreadsheet task in Excel, you typically get a series of steps to click through menus and dialogs. When you ask for a SQL query, you get code you can modify and rerun instantly. Both approaches work, but for iterative data work, the SQL workflow can be faster. As for AI agents, they generate code that is difficult for most people to modify and iterate over. Joinery offers a practical balance between traditional Excel workflows and fully automated AI agents.

**Build reusable workflows.** Save queries with `{{parameters}}` for processes you run repeatedly. Need to run the same analysis on new data each week? Use the runtime parameters to update the query and execute. Chain multiple queries together for complex workflows that run end-to-end with one click.

**Everything runs locally on your device.** Use it in your browser with no installation, or download the desktop app for native performance. Your data never leaves your machine. DuckDB's columnar engine delivers speed that rivals enterprise databases, and Joinery is completely free and open-source.

## ✨ Features

- **🦆 DuckDB-Powered Analytics:** Full-featured SQL engine running in WebAssembly (web) or native Rust client (desktop).
- **🔒 Privacy-First Architecture:** All data processing happens locally on your device. Zero cloud uploads.
- **📁 Multi-Format Support:** Import and query CSV, Excel, JSON, Parquet, and more.
- **🎨 Modern SQL Editor:** Monaco-based editor with syntax highlighting, IntelliSense, and auto-completion.
- **📑 Tabbed & Concurrent Workflow:** Open multiple tabs and run multiple queries per tab. Desktop edition supports true concurrent query execution.
- **⚡ Fast Query Execution:** Leverages DuckDB's columnar engine and Apache Arrow for performance.
- **📊 Rich Results Interface:** Paginated, sortable, and filterable result tables with save and export options.
- **🔄 Parameterized Saved Queries:** Save and reuse queries with `{{variable}}` placeholders for repeatable workflows.
- **🗄️ Multi-Database Management:** Create, import, export, and switch between multiple databases.
- **💾 Persistent Storage:** Auto-saves databases to browser storage (web) or local filesystem (desktop).
- **🚀 Quick Actions:** Options to quickly copy database schemas, export table data, rename tables, change table schemas, and more.
- **🌙 Dark Mode:** Polished light and dark themes.

## 🚀 Quick Start

### 🌐 Web Version

Run Joinery in your browser:

```bash
# Clone the repository
git clone https://github.com/joinery-labs/joinery.git
cd joinery

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

**Build for production:**
```bash
npm run build
```

### 💻 Desktop App (Tauri)

Get the native desktop experience with better performance.

**Prerequisites:** Ensure you have Rust and platform-specific dependencies installed. See the [Tauri Prerequisites Guide](https://v2.tauri.app/start/prerequisites/).

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build distributable application
npm run tauri build
```

The built application will be in `src-tauri/target/release/`.

## 📁 Project Structure

```
joinery/
├── src/
│   ├── css/
│   │   ├── base/               # Theme variables, typography, utilities
│   │   ├── components/         # Reusable UI components (buttons, modals, etc.)
│   │   ├── features/           # Feature-specific styling
│   │   └── layout/             # Layout structures (toolbar, masonry, etc.)
│   ├── js/
│   │   ├── core/               # Database engine, event bus, backends
│   │   ├── editor/             # Monaco editor integration
│   │   ├── features/           # Main application features
│   │   │   ├── export-import/
│   │   │   ├── file-upload/
│   │   │   ├── query-editor/
│   │   │   ├── results/
│   │   │   └── table-manager/
│   │   ├── platform/           # Web vs. Tauri platform abstraction
│   │   │   ├── backends/
│   │   ├── ui/                 # UI components
│   │   └── utils/              # Helper functions and utilities
│   └── index.html
├── src-tauri/                  # Desktop application
│   ├── src/                    # Rust application code
│   ├── capabilities/           # Tauri capabilities configuration
│   └── tauri.conf.json         # Tauri configuration
├── README.md
├── CONTRIBUTING.md
├── LICENSE
├── package.json
└── vite.config.js
```

## 🤝 Contributing

We welcome contributions! Whether you're fixing bugs, adding features, or improving documentation, your help makes Joinery better.

**Before contributing:**
- Read our [Contributing Guide](./CONTRIBUTING.md).
- Check existing [Issues](https://github.com/joinery-labs/joinery/issues).
- For major changes, please open an issue or a discussion for prior review.

## 🗺️ Roadmap

The following major features are planned. Minor improvements and bug fixes will continue on an ongoing basis.

- **Multi-window support:** Pop out tabs into separate windows for flexible layouts.
- **Declarative charting:** Create visualizations through simple, declarative configuration.

## 🙏 Acknowledgments

- **[DuckDB WASM](https://github.com/duckdb/duckdb-wasm)** and **[DuckDB Rust](https://github.com/duckdb/duckdb-rs)** for SQL database.
- **[Bootstrap](https://github.com/twbs/bootstrap)** for UI components and styling.
- **[Tauri](https://github.com/tauri-apps/tauri)** for desktop framework.
- **[Monaco Editor](https://github.com/microsoft/monaco-editor)** for code editor.
- **[Apache Arrow](https://github.com/apache/arrow)** for columnar data format.
- **[SheetJS](https://sheetjs.com/)** for Excel file processing.
- **[Sql-formatter](https://github.com/sql-formatter-org/sql-formatter)** for SQL formatting.
- **[Day.js](https://github.com/iamkun/dayjs)** for date manipulation.
- **[JSZip](https://github.com/Stuk/jszip)** for ZIP file handling.
- **[Inter Font](https://github.com/rsms/inter)** for UI typography.

## 🆘 Support

- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/joinery-labs/joinery/issues)
- 💡 **Feature Requests:** [GitHub Discussions](https://github.com/joinery-labs/joinery/discussions)