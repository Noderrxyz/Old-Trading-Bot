module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
        modules: 'commonjs', // Convert ESM to CommonJS when needed
      },
    ],
  ],
  // Keep ESM intact when encountered in .mjs files
  overrides: [
    {
      test: /\.mjs$/,
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              node: 'current',
            },
            modules: false, // Preserve ESM for .mjs files
          },
        ],
      ],
    },
  ],
}; 