import { buildSchema, parse, type DocumentNode } from 'graphql'
import test from 'node:test'
import { validateOperationsAndReportDeprecatedFields } from '../src/utils'
import assert from 'node:assert'

function makeDocumentMap(str: string) {
  const documentsMap = new Map<string, DocumentNode>()
  documentsMap.set('test.graphql', parse(str))
  return documentsMap
}

function buildSchemaWithRootQuery(str: string) {
  // GraphQL validation rules imply that a schema must have a Query type
  if (str.match(/type\sQuery[^a-zA-Z0-9_]/)) return buildSchema(str)
  return buildSchema('type Query { ok: String } ' + str)
}

function assertValid(schemaString: string, queryString: string, expectedResult: string) {
  const schema = buildSchemaWithRootQuery(schemaString)
  const documentsMap = makeDocumentMap(queryString)
  const deprecatedFields = validateOperationsAndReportDeprecatedFields(
    schema,
    documentsMap,
    new Map(),
    new Map(),
    false,
  )
  assert.equal(deprecatedFields.size, 1)
  assert.equal(deprecatedFields.values().next().value, expectedResult)
}

test('find deprecated query', () => {
  assertValid(
    `
    type Query {
      someQuery: String @deprecated(reason: "Use nothing instead")
    }
    `,
    `query Test { someQuery }`,
    'Query "someQuery" is deprecated',
  )
})

test('find deprecated mutation', () => {
  assertValid(
    `
    type Mutation {
      someMutation(input: String!): String! @deprecated(reason: "Use nothing instead")
    }
    `,
    `mutation Test { someMutation(input:"hi") }`,
    'Mutation "someMutation" is deprecated',
  )
})

test('find deprecated subscription', () => {
  assertValid(
    `
    type Subscription {
      someSubscription(input: String!): String! @deprecated(reason: "Use nothing instead")
    }
    `,
    `subscription Test { someSubscription(input:"hi") }`,
    'Subscription "someSubscription" is deprecated',
  )
})

test('find deprecated field', () => {
  assertValid(
    `
    type SomePayload {
      ok: Boolean
      notOk: String @deprecated(reason: "Use ok instead")
    }
    type Query {
      someQuery: SomePayload
    }
    `,
    `query Test { someQuery { ok notOk } }`,
    'Field "SomePayload.notOk" is deprecated',
  )
})

test('find deprecated arg', () => {
  assertValid(
    `
    type SomePayload {
      ok: Boolean
    }
    type Query {
      someQuery(arg: String @deprecated(reason: "Stop using it")): SomePayload
    }
    `,
    `query Test { someQuery(arg: "hi") { ok } }`,
    'Argument "arg" from "someQuery" is deprecated',
  )
})
