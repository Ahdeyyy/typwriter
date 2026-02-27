= AGENTS.md

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
- Run `bun run generate-parser` to generate the parser from the grammar file. This will create a `parser.js` file in the project directory, which can be imported and used in the codebase.
- Make sure to keep the `parser.js` file up to date with any changes made to the `typst.grammar` file by running the above command whenever modifications are made to the grammar.
