import { relative } from 'node:path'
import { readFile as readFileAsync } from 'node:fs/promises'
import { globIterate } from 'glob'
import {
  GraphQLSchema,
  Kind,
  parse,
  TypeInfo,
  validate,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type FragmentDefinitionNode,
} from 'graphql'

export function readFile(filePath: string) {
  return readFileAsync(filePath, { encoding: 'utf-8' })
}

export async function findOperationDocuments(operationsGlob: string, schemaFilePath: string) {
  const documentsMap = new Map<string, DocumentNode>()

  for await (const operationFilePath of globIterate(operationsGlob)) {
    if (relative('.', operationFilePath) === relative('.', schemaFilePath)) continue

    const document = parse(await readFile(operationFilePath))
    documentsMap.set(operationFilePath, document)
  }

  return documentsMap
}

export function collectFragmentDependencies(documentsMap: Map<string, DocumentNode>) {
  const fragmentsByName = new Map<string, FragmentDefinitionNode>()
  const dependenciesByFragmentName = new Map<string, Set<string>>()

  for (const document of documentsMap.values()) {
    document.definitions.forEach((frag) => {
      if (frag.kind !== Kind.FRAGMENT_DEFINITION) return
      fragmentsByName.set(frag.name.value, frag)
      const dependencies = listFragmentDependencies(frag)
      dependenciesByFragmentName.set(frag.name.value, dependencies)
    })
  }

  return { fragmentsByName, dependenciesByFragmentName }
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

export function validateOperationsAndReportDeprecatedFields(
  schema: GraphQLSchema,
  documentsMap: Map<string, DocumentNode>,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  dependenciesByFragmentName: Map<string, Set<string>>,
  shouldReportFiles: boolean,
) {
  const deprecatedFields = new Set<string>()
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
        Argument(node) {
          const argDef = typeInfo.getArgument()
          if (argDef && argDef.deprecationReason) {
            const parentType = typeInfo.getFieldDef()
            const parentTypeName = parentType ? parentType.name : 'Unknown Type'
            deprecatedFields.add(
              `Argument "${node.name.value}" from "${parentTypeName}" is deprecated${shouldReportFiles ? ` in ${operationFilePath}` : ''}`,
            )
          }
        },
        Field(node) {
          const fieldDef = typeInfo.getFieldDef()
          if (fieldDef && fieldDef.deprecationReason) {
            const parentType = typeInfo.getParentType()
            const parentTypeName = parentType ? parentType.name : 'Unknown Type'
            switch (parentTypeName) {
              case 'Mutation':
              case 'Query':
              case 'Subscription':
                deprecatedFields.add(
                  `${parentTypeName} "${node.name.value}" is deprecated${shouldReportFiles ? ` in ${operationFilePath}` : ''}`,
                )
                break
              default:
                deprecatedFields.add(
                  `Field "${parentTypeName}.${node.name.value}" is deprecated${shouldReportFiles ? ` in ${operationFilePath}` : ''}`,
                )
            }
          }
        },
      }),
    )
  }
  return deprecatedFields
}
