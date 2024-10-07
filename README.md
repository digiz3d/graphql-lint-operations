# graphql-lint-operations

This GitHub Action is used to validate operation files against a schema file.  
Any deprecated field will be reported and make the CI fail.

![Output in standard terminal](docs/out.png)

## Usage

You need the operation files (queries/mutations/subscriptions) and the schema file.

If you commit the schema file in the client codebase, you can just use this action

```yaml
  - uses: actions/checkout@v4
  - uses: digiz3d/graphql-lint-operations@v0.1.5
    with:
      schema-file: './wherever/you/put/the/schema.graphql'
      operation-files-glob: '**/*.graphql'
```

If you don't commit the schema, then you might fetch it using rover

```yaml
  - uses: actions/checkout@v4
  - name: Install Rover
    run: |
      curl -sSL https://rover.apollo.dev/nix/latest | sh
      echo 'export PATH=$HOME/.rover/bin:$PATH' >> $BASH_ENV
  - name: Fetch GraphQL schema
    run: rover graph fetch YourOrg@environment --output ./downloaded-schema.graphql
    env:
      APOLLO_KEY: ${{ secrets.APOLLO_KEY }}
  - uses: digiz3d/graphql-lint-operations@v0.1.5
    with:
      schema-file: './downloaded-schema.graphql'
      operation-files-glob: '**/*.graphql'
```

## Tech details

Using [ncc](https://github.com/vercel/ncc) as a bundler

`dist` is committed be able to run with a `node20` runner without any installation step.
