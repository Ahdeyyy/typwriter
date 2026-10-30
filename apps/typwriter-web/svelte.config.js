import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The landing page is prerendered; release metadata is fetched after mount
		// so download links stay current between deployments.
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
