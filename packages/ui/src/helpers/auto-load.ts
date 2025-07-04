import constants from '@/constants'
import {
    convertInsomniaExportToRestfoxCollection,
    convertRestfoxExportToRestfoxCollection,
    convertOpenAPIExportToRestfoxCollection,
    generateNewIdsForTree,
    flattenTree,
    fileToJSON,
    fileToString
} from '@/helpers'
import { convertPostmanExportToRestfoxCollection } from '@/parsers/postman'
import { mergeArraysByProperty } from '@/utils/array'

export interface AutoLoadResult {
    success: boolean
    error?: string
    collectionsLoaded: number
    environmentsLoaded: number
}

export interface FileContent {
    name: string
    content: any
    type: 'json' | 'string'
}

export interface ConfigFile {
    collections?: string[]
    environments?: string[]
}

/**
 * Reads and parses a YAML config file to get collections and environments lists
 */
async function readConfigFile(configFilePath: string): Promise<ConfigFile | null> {
    try {
        const fileContent = await readLocalFile(configFilePath)
        if (!fileContent) {
            console.log(`Config file not found: ${configFilePath}`)
            return null
        }

        let yamlContent: string
        if (fileContent.type === 'json') {
            // If it's JSON, convert to string first
            yamlContent = typeof fileContent.content === 'string' 
                ? fileContent.content 
                : JSON.stringify(fileContent.content)
        } else {
            yamlContent = fileContent.content
        }

        let parsedConfig: ConfigFile
        
        try {
            // Try to use js-yaml if available
            const { load: yamlLoad } = await import('js-yaml')
            parsedConfig = yamlLoad(yamlContent) as ConfigFile
        } catch (importError) {
            // Fallback: simple YAML parser for basic list structure
            console.log('js-yaml not available, using simple YAML parser')
            parsedConfig = parseSimpleYaml(yamlContent)
        }
        
        if (!parsedConfig || typeof parsedConfig !== 'object') {
            console.warn(`Invalid config file format: ${configFilePath}`)
            return null
        }

        return parsedConfig
    } catch (error) {
        console.error(`Failed to read config file ${configFilePath}:`, error)
        return null
    }
}

/**
 * Simple YAML parser for basic list structures
 */
function parseSimpleYaml(yamlString: string): ConfigFile {
    const result: ConfigFile = {}
    const lines = yamlString.split('\n')
    let currentSection: 'collections' | 'environments' | null = null
    
    for (const line of lines) {
        const trimmed = line.trim()
        
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
            continue
        }
        
        // Check for section headers
        if (trimmed === 'collections:') {
            currentSection = 'collections'
            result.collections = []
            continue
        }
        
        if (trimmed === 'environments:') {
            currentSection = 'environments'
            result.environments = []
            continue
        }
        
        // Check for list items
        if (trimmed.startsWith('- ') && currentSection) {
            const item = trimmed.substring(2).trim()
            // Remove quotes if present
            const cleanItem = item.replace(/^["']|["']$/g, '')
            result[currentSection]!.push(cleanItem)
        }
    }
    
    return result
}

/**
 * Reads a file from the file system (Electron) or fetches from HTTP (Web)
 */
async function readLocalFile(filePath: string): Promise<FileContent | null> {
    try {
        // In Electron environment, we can read files directly
        if (import.meta.env.MODE === 'desktop-electron') {
            if (window.electronIPC && window.electronIPC.readFile) {
                const content = await window.electronIPC.readFile(filePath)
                const fileName = filePath.split('/').pop() || filePath
                
                if (fileName.endsWith('.json')) {
                    return {
                        name: fileName,
                        content: JSON.parse(content),
                        type: 'json'
                    }
                } else {
                    return {
                        name: fileName,
                        content: content,
                        type: 'string'
                    }
                }
            }
        } else {
            // In web environment, try to fetch the file via HTTP
            try {
                const response = await fetch(filePath)
                if (!response.ok) {
                    console.warn(`Failed to fetch file ${filePath}: ${response.statusText}`)
                    return null
                }
                
                const fileName = filePath.split('/').pop() || filePath
                const content = await response.text()
                
                try {
                    const jsonContent = JSON.parse(content)
                    return {
                        name: fileName,
                        content: jsonContent,
                        type: 'json'
                    }
                } catch (error) {
                    return {
                        name: fileName,
                        content,
                        type: 'string'
                    }
                }
            } catch (error) {
                console.warn(`Failed to fetch file ${filePath}:`, error)
                return null
            }
        }
        
        return null
    } catch (error) {
        console.error(`Failed to read file ${filePath}:`, error)
        return null
    }
}

/**
 * Attempts to read multiple files and returns successful reads
 */
async function readMultipleFiles(filePaths: string[]): Promise<FileContent[]> {
    const results: FileContent[] = []
    
    for (const filePath of filePaths) {
        const fileContent = await readLocalFile(filePath)
        if (fileContent) {
            results.push(fileContent)
        }
    }
    
    return results
}

/**
 * Processes a file and converts it to Restfox format based on import type
 */
async function processImportFile(
    fileContent: FileContent, 
    importType: string, 
    workspaceId: string
): Promise<{ collectionTree: any[], plugins: any[], environments?: any[] }> {
    let collectionTree: any[] = []
    let plugins: any[] = []
    let environments: any[] = []
    
    const { content } = fileContent
    
    try {
        switch (importType) {
            case 'Postman':
                const postmanResult = await convertPostmanExportToRestfoxCollection(content, false, workspaceId)
                // Handle different return types from Postman conversion
                if (Array.isArray(postmanResult)) {
                    // importPostmanV1 returns CollectionItem[]
                    collectionTree = postmanResult
                    plugins = []
                } else {
                    // importPostmanV2 returns { collection, plugins }
                    collectionTree = postmanResult.collection
                    plugins = postmanResult.plugins || []
                }
                break
                
            case 'Insomnia':
                collectionTree = convertInsomniaExportToRestfoxCollection(content, workspaceId)
                break
                
            case 'Restfox':
                const restfoxResult = convertRestfoxExportToRestfoxCollection(content, workspaceId)
                collectionTree = restfoxResult.newCollectionTree
                plugins = restfoxResult.newPlugins || []
                if (content.environments) {
                    environments = content.environments
                }
                break
                
            case 'OpenAPI':
                const openApiContent = typeof content === 'string' ? content : JSON.stringify(content)
                collectionTree = await convertOpenAPIExportToRestfoxCollection(openApiContent, workspaceId)
                break
                
            default:
                console.warn(`Unsupported import type: ${importType}`)
                break
        }
        
        // Generate new IDs for the imported items
        if (collectionTree.length > 0) {
            const oldIdNewIdMapping = generateNewIdsForTree(collectionTree)
            
            // Update plugin collection IDs if they exist
            plugins.forEach(plugin => {
                if (plugin.collectionId && oldIdNewIdMapping[plugin.collectionId]) {
                    plugin.collectionId = oldIdNewIdMapping[plugin.collectionId]
                }
            })
        }
        
        return { collectionTree, plugins, environments }
    } catch (error) {
        console.error(`Failed to process import file ${fileContent.name}:`, error)
        throw error
    }
}

/**
 * Auto-loads collections and environments based on configuration
 */
export async function autoLoadData(
    workspaceId: string,
    activeWorkspace: any,
    store: any
): Promise<AutoLoadResult> {
    const config = constants.AUTO_LOAD
    
    if (!config.ENABLED) {
        return {
            success: true,
            collectionsLoaded: 0,
            environmentsLoaded: 0
        }
    }
    
    try {
        let totalCollectionsLoaded = 0
        let totalEnvironmentsLoaded = 0
        let allCollectionTree: any[] = []
        let allPlugins: any[] = []
        
        // Read config file to get collections and environments lists
        const configData = await readConfigFile(config.CONFIG_FILE)
        if (!configData) {
            console.log('No config file found or config file is invalid, skipping auto-load')
            return {
                success: true,
                collectionsLoaded: 0,
                environmentsLoaded: 0
            }
        }
        
        // Load collection files
        if (configData.collections && configData.collections.length > 0) {
            console.log('Auto-loading collections from:', configData.collections)
            const collectionFiles = await readMultipleFiles(configData.collections)
            
            for (const fileContent of collectionFiles) {
                try {
                    const result = await processImportFile(
                        fileContent, 
                        config.DEFAULT_IMPORT_TYPE, 
                        workspaceId
                    )
                    
                    allCollectionTree = allCollectionTree.concat(result.collectionTree)
                    allPlugins = allPlugins.concat(result.plugins)
                    
                    if (result.environments && result.environments.length > 0) {
                        // Handle environments from collection files
                        if (config.MERGE_ENVIRONMENTS) {
                            activeWorkspace.environments = mergeArraysByProperty(
                                activeWorkspace.environments ?? [], 
                                result.environments, 
                                'name'
                            )
                        } else {
                            activeWorkspace.environments = result.environments
                        }
                        
                        await store.commit('updateWorkspaceEnvironments', {
                            workspaceId: workspaceId,
                            environments: activeWorkspace.environments
                        })
                        
                        totalEnvironmentsLoaded += result.environments.length
                    }
                    
                    totalCollectionsLoaded++
                    console.log(`Successfully loaded collection from: ${fileContent.name}`)
                } catch (error) {
                    console.error(`Failed to load collection from ${fileContent.name}:`, error)
                }
            }
        }
        
        // Load environment files
        if (configData.environments && configData.environments.length > 0) {
            console.log('Auto-loading environments from:', configData.environments)
            const environmentFiles = await readMultipleFiles(configData.environments)
            
            for (const fileContent of environmentFiles) {
                try {
                    const environments = Array.isArray(fileContent.content) 
                        ? fileContent.content 
                        : [fileContent.content]
                    
                    if (config.MERGE_ENVIRONMENTS) {
                        activeWorkspace.environments = mergeArraysByProperty(
                            activeWorkspace.environments ?? [], 
                            environments, 
                            'name'
                        )
                    } else {
                        activeWorkspace.environments = environments
                    }
                    
                    await store.commit('updateWorkspaceEnvironments', {
                        workspaceId: workspaceId,
                        environments: activeWorkspace.environments
                    })
                    
                    totalEnvironmentsLoaded += environments.length
                    console.log(`Successfully loaded environments from: ${fileContent.name}`)
                } catch (error) {
                    console.error(`Failed to load environments from ${fileContent.name}:`, error)
                }
            }
        }
        
        // Import collections and plugins if any were loaded
        if (allCollectionTree.length > 0) {
            const result = await store.dispatch('setCollectionTree', {
                collectionTree: allCollectionTree,
                parentId: null,
                plugins: allPlugins
            })
            
            if (result.error) {
                throw new Error(result.error)
            }
            
            console.log(`Auto-loaded ${totalCollectionsLoaded} collection files with ${allCollectionTree.length} items`)
        }
        
        return {
            success: true,
            collectionsLoaded: totalCollectionsLoaded,
            environmentsLoaded: totalEnvironmentsLoaded
        }
    } catch (error) {
        console.error('Auto-loading failed:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            collectionsLoaded: 0,
            environmentsLoaded: 0
        }
    }
}

/**
 * Checks if auto-loading should be skipped for this workspace
 */
export function shouldSkipAutoLoad(activeWorkspace: any, collectionTree: any[]): boolean {
    const config = constants.AUTO_LOAD
    
    if (!config.ENABLED) {
        return true
    }
    
    if (config.SKIP_ON_EXISTING_DATA && collectionTree.length > 0) {
        console.log('Skipping auto-load: workspace already has collections')
        return true
    }
    
    return false
} 