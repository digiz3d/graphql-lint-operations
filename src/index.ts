import { getBooleanInput, getInput } from '@actions/core'
import { buildSchema } from 'graphql'
import {
  collectFragmentDependencies,
  findOperationDocuments,
  readFile,
  validateOperationsAndReportDeprecatedFields,
} from './utils'

const runningOnCI = process.env.CI === 'true'

const schemaFilePath = runningOnCI ? getInput('schema-file', { required: true }) : process.env.SCHEMA_FILE
const operationsGlob = runningOnCI
  ? getInput('operation-files-glob', { required: true })
  : process.env.OPERATION_FILES_GLOB!
const shouldReportFiles = runningOnCI
  ? getBooleanInput('report-files', { required: true })
  : process.env.REPORT_FILES !== 'false'

if (!schemaFilePath) {
  throw new Error('Missing schema file path')
}
if (!operationsGlob) {
  throw new Error('Missing operations glob')
}

const operationDocuments = await findOperationDocuments(operationsGlob, schemaFilePath)
const { fragmentsByName, dependenciesByFragmentName } = collectFragmentDependencies(operationDocuments)
const schemaFileContent = await readFile(schemaFilePath)
const schema = buildSchema(schemaFileContent)
const deprecatedFields = validateOperationsAndReportDeprecatedFields(
  schema,
  operationDocuments,
  fragmentsByName,
  dependenciesByFragmentName,
  shouldReportFiles,
)

if (deprecatedFields.size > 0) {
  console.error('Deprecated fields found.')
  deprecatedFields.forEach((field) => console.error(field))
  process.exit(1)
} else {
  console.log('No deprecated fields found. GG!')
}
