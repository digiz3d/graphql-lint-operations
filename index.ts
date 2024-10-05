import { Glob, file } from 'bun'
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

const schemaFilePath = process.env.SCHEMA_FILE!
const operationsGlob = new Glob(process.env.OPERATION_FILES_GLOB!)
const shouldReportFiles = process.env.REPORT_FILES !== 'false'

const schema = buildSchema(await file(schemaFilePath).text())

const fragmentsByName = new Map<string, FragmentDefinitionNode>()
const dependenciesByFragmentName = new Map<string, Set<string>>()

function listFragmentDependencies(fragment: DocumentNode | FragmentDefinitionNode) {
  const dependencies = new Set<string>()
  visit(fragment, {
    FragmentSpread(node) {
      dependencies.add(node.name.value)
    },
  })
  return dependencies
}

const documentsMap = new Map<string, DocumentNode>()

for await (const operationFilePath of operationsGlob.scan('.')) {
  if (operationFilePath === schemaFilePath) continue

  const document = parse(await file(operationFilePath).text())
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

const deprecatedFields = new Set<string>()

// second pass, validate operations and fragments
for (const [operationFilePath, document] of documentsMap) {
  const operationDefinitions = document.definitions.filter((def) => def.kind === Kind.OPERATION_DEFINITION)

  if (operationDefinitions.length === 0) continue

  const usedFragmentsNames = listFragmentDependencies(document)

  function recursivelyAddDependencies(fragmentName: string) {
    const dependencies = dependenciesByFragmentName.get(fragmentName)
    if (!dependencies) return
    dependencies.forEach((dep) => {
      usedFragmentsNames.add(dep)
      recursivelyAddDependencies(dep)
    })
  }

  usedFragmentsNames.forEach((fragmentName) => {
    recursivelyAddDependencies(fragmentName)
  })

  const requiredFragmentsDefinitions = new Set<FragmentDefinitionNode>()

  usedFragmentsNames.forEach((fragmentName) => {
    const frag = fragmentsByName.get(fragmentName)
    if (!frag) {
      throw new Error(`Missing fragment "${fragmentName}" in ${operationFilePath}`)
    }
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
    errors.forEach((error) => {
      console.log('errr', error, typeof error, error instanceof Error, Object.getOwnPropertyNames(error), error.message)
      console.error(error.message)
    })
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
  let msg = 'Deprecated fields found ❌\n'
  msg += Array.from(deprecatedFields).join('\n')
  console.error(msg)
  process.exit(1)
} else {
  console.log('No deprecated fields found. GG ✅')
}
