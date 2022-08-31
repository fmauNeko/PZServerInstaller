import babel from '@rollup/plugin-babel';

const config = {
  input: 'src/app.js',
  output: {
    dir: 'dist',
    format: 'esm'
  },
  plugins: [babel({ babelHelpers: 'bundled' })]
};

export default config;