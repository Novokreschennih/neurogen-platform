/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		"./src/**/*.{njk,html,js,md}",
		"./src/_includes/**/*.{njk,html,js}",
		"./_site/**/*.{html,js}",
	],
	theme: {
		extend: {},
	},
	plugins: [],
};
