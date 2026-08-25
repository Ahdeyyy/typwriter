import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The landing page is fully prerendered — there is no server at runtime.
		// The GitHub release lookup in +page.server.ts therefore runs once at
		// build time instead of once per visitor, which also keeps it clear of
		// the unauthenticated API's 60-requests-per-hour-per-IP limit.
		adapter: adapter(),
		alias: {
			'@/*': './src/lib/*'
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
