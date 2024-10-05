import { readFile as readFileAsync } from 'node:fs/promises'
import { getBooleanInput, getInput } from '@actions/core'
import { globIterate } from 'glob'
import {
  buildSchema,
  type DocumentNode,
  type FragmentDefinitionNode,
  Kind,
  parse,
  TypeInfo,
  validate,
  visit,
  visitWithTypeInfo,
} from 'graphql'

const schemaFilePath = process.env.SCHEMA_FILE || getInput('schema-file', { required: true })
const operationsGlob = process.env.OPERATION_FILES_GLOB || getInput('operation-files-glob', { required: true })
const shouldReportFiles = process.env.REPORT_FILES || getBooleanInput('report-files', { required: true })

const fragmentsByName = new Map<string, FragmentDefinitionNode>()
const dependenciesByFragmentName = new Map<string, Set<string>>()

const documentsMap = new Map<string, DocumentNode>()

for await (const operationFilePath of globIterate(operationsGlob)) {
  if (operationFilePath === schemaFilePath) continue

  const document = parse(await readFile(operationFilePath))
  documentsMap.set(operationFilePath, document)
}

// first pass, collect all fragments and their dependencies
for (const document of documentsMap.values()) {
  document.definitions.forEach((frag) => {
    if (frag.kind !== Kind.FRAGMENT_DEFINITION) return
    fragmentsByName.set(frag.name.value, frag)
    const dependencies = listFragmentDependencies(frag)
    dependenciesByFragmentName.set(frag.name.value, dependencies)
  })
}

const schema = buildSchema(await readFile(schemaFilePath))
const deprecatedFields = new Set<string>()

// second pass, validate operations and fragments
for (const [operationFilePath, document] of documentsMap.entries()) {
  const operationDefinitions = document.definitions.filter((def) => def.kind === Kind.OPERATION_DEFINITION)

  if (operationDefinitions.length === 0) continue

  const usedFragmentsNames = listFragmentDependencies(document)

  function recursivelyAddDependencies(fragmentName: string) {
    const dependencies = dependenciesByFragmentName.get(fragmentName)
    if (!dependencies?.size) return

    dependencies.forEach((dependencyName) => {
      if (usedFragmentsNames.has(dependencyName)) return

      usedFragmentsNames.add(dependencyName)
      recursivelyAddDependencies(dependencyName)
    })
  }

  usedFragmentsNames.forEach((fragmentName) => {
    recursivelyAddDependencies(fragmentName)
  })

  const requiredFragmentsDefinitions = new Set<FragmentDefinitionNode>()

  usedFragmentsNames.forEach((fragmentName) => {
    const frag = fragmentsByName.get(fragmentName)
    if (!frag) throw new Error(`Missing fragment "${fragmentName}" in ${operationFilePath}`)

    requiredFragmentsDefinitions.add(frag)
  })

  const documentWithFragments = {
    ...document,
    definitions: [...operationDefinitions, ...requiredFragmentsDefinitions],
  }

  const errors = validate(schema, documentWithFragments).filter(
    (error) => !error.message.startsWith('Unknown directive'),
  )

  if (errors.length > 0) {
    console.error('Validation errors:')
    errors.forEach((error) => console.error(error.message))
  }

  const typeInfo = new TypeInfo(schema)
  visit(
    documentWithFragments,
    visitWithTypeInfo(typeInfo, {
      Field(node) {
        const fieldDef = typeInfo.getFieldDef()
        if (fieldDef && fieldDef.deprecationReason) {
          const parentType = typeInfo.getParentType()
          const parentTypeName = parentType ? parentType.name : 'Unknown Type'
          deprecatedFields.add(
            `"${parentTypeName}.${node.name.value}" is deprecated${shouldReportFiles ? ` in ${operationFilePath}` : ''}`,
          )
        }
      },
    }),
  )
}

if (deprecatedFields.size > 0) {
  console.error('Deprecated fields found ❌')
  deprecatedFields.forEach((field) => console.error(field))
  process.exit(1)
} else {
  console.log('No deprecated fields found. GG ✅')
}

function readFile(filePath: string) {
  return readFileAsync(filePath, { encoding: 'utf-8' })
}

function listFragmentDependencies(fragment: DocumentNode | FragmentDefinitionNode) {
  const dependencies = new Set<string>()
  visit(fragment, {
    FragmentSpread(node) {
      dependencies.add(node.name.value)
    },
  })
  return dependencies
}
