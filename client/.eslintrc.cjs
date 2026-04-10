module.exports = {
	root: true,
	env: { browser: true, es2020: true },
	extends: [
		"eslint:recommended",
		"@typescript-eslint/recommended",
		"plugin:react/recommended",
		"plugin:react/jsx-runtime",
		"plugin:react-hooks/recommended",
	],
	ignorePatterns: ["dist", ".eslintrc.cjs"],
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: "latest",
		sourceType: "module",
		project: "./tsconfig.json"
	},
	settings: { react: { version: "18.2" } },
	plugins: ["react-refresh", "@typescript-eslint"],
	rules: {
		"react/jsx-no-target-blank": "off",
		"react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
		"react/no-unescaped-entities": "off",
		"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
	},
	globals: {
		__APP_VERSION__: "readonly",
		process: "readonly",
	},
};
