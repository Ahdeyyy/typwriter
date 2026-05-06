= CLAUDE.md

== Naming Conventions

- Use camelCase for variable and function names. For example, `myVariable` and `myFunction()`.
- Use PascalCase for class names. For example, `MyClass`.

== package management

- This project uses bun as the package manager. To install dependencies, run `bun install` in the project root.
- To add a new dependency, use `bun add <package-name>`. For example, to add the `lodash` library, run `bun add lodash`.
- To remove a dependency, use `bun remove <package-name>`. For example, to remove the `lodash` library, run `bun remove lodash`.
- To update all dependencies to their latest versions, run `bun update`.
- To check for outdated dependencies, run `bun outdated`.
- To run scripts defined in the `package.json` file, use `bun run <script-name>`. For example, to start the development server, run `bun run dev`.
- To build the project for production, run `bun run build`.
- To run tests, use `bun run test`. Make sure to configure your test scripts in the `package.json` file accordingly.
- For more information on using bun, refer to the official documentation: https://bun.sh/docs/cli/install
- Do not attempt to run the app server, this is a desktop app thus you can't use the browser to view the app.

- To validate any changes made to the rust code, run `cargo check` in the `/src-tauri` directory.
