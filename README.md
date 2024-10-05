# graphql-lint-operations

This GitHub Action is used to validate operation files against a schema file.  
Any deprecated field will be reported and make the CI fail.

## Tech details

Using [ncc](https://github.com/vercel/ncc) as a bundler

`dist` is committed be able to run with a `node20` runner without any installation step.
