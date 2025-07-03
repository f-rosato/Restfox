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
                
                if (fileName.endsWith('.json')) {
                    const content = await response.json()
                    return {
                        name: fileName,
                        content,
                        type: 'json'
                    }
                } else {
                    const content = await response.text()
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
        
        // Load collection files
        if (config.FILES.COLLECTIONS.length > 0) {
            console.log('Auto-loading collections from:', config.FILES.COLLECTIONS)
            const collectionFiles = await readMultipleFiles(config.FILES.COLLECTIONS)
            
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
        if (config.FILES.ENVIRONMENTS.length > 0) {
            console.log('Auto-loading environments from:', config.FILES.ENVIRONMENTS)
            const environmentFiles = await readMultipleFiles(config.FILES.ENVIRONMENTS)
            
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