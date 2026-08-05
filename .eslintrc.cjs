module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  env: {
    node: true,
    es2022: true
  },
  rules: {
    indent: ['error', 2],
    semi: ['error', 'never'],
    'no-sync': 'error',
    'max-lines': ['error', { max: 150, skipComments: true, skipBlankLines: true }],
    'max-lines-per-function': ['error', { max: 30, skipComments: true, skipBlankLines: true }],
    'max-params': ['error', 4],
    'no-undef': 'error'
  }
}