import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  collectFragmentDependencies,
  findOperationDocuments,
  readFile,
  validateOperationsAndReportDeprecatedFields,
} from '../src/utils'
import { buildSchema } from 'graphql'

const schemaFilePath = './test/schema.graphql'
const operationsGlob = './test/*.graphql'

test('should find all deprecated usages', async () => {
  const operationDocuments = await findOperationDocuments(operationsGlob, schemaFilePath)
  assert.equal(operationDocuments.size, 3)

  const { fragmentsByName, dependenciesByFragmentName } = collectFragmentDependencies(operationDocuments)
  assert.equal(fragmentsByName.size, 2)
  assert.equal(dependenciesByFragmentName.size, 2)

  const schemaFileContent = await readFile(schemaFilePath)
  const schema = buildSchema(schemaFileContent)

  const reportTypes = validateOperationsAndReportDeprecatedFields(
    schema,
    operationDocuments,
    fragmentsByName,
    dependenciesByFragmentName,
    false,
  )
  assert.equal(reportTypes.size, 3)

  const reportTypesWithFiles = validateOperationsAndReportDeprecatedFields(
    schema,
    operationDocuments,
    fragmentsByName,
    dependenciesByFragmentName,
    true,
  )
  assert.equal(reportTypesWithFiles.size, 3)
})
