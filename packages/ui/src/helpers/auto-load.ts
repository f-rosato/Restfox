import constants from '@/constants'
import {
    convertInsomniaExportToRestfoxCollection,
    convertRestfoxExportToRestfoxCollection,
    convertOpenAPIExportToRestfoxCollection,
    generateNewIdsForTree,
    flattenTree
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
        // Wait for auto-load to be initialized on server (retry for up to 1 minute)
        let statusInitialized = false
        let retryCount = 0
        const maxRetries = 30 // 30 retries * 2 seconds = 60 seconds
        
        while (!statusInitialized && retryCount < maxRetries) {
            try {
                const statusResponse = await fetch('/api/auto-load/status')
                const status = await statusResponse.json()
                
                if (status.initialized) {
                    statusInitialized = true
                    console.log('Auto-load initialized on server')
                } else {
                    console.log(`Auto-load not yet initialized, retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`)
                    await new Promise(resolve => setTimeout(resolve, 2000))
                    retryCount++
                }
            } catch (error) {
                console.log(`Error checking auto-load status, retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`)
                await new Promise(resolve => setTimeout(resolve, 2000))
                retryCount++
            }
        }
        
        if (!statusInitialized) {
            console.log('Auto-load failed to initialize within timeout period')
            return {
                success: false,
                error: 'Auto-load initialization timeout',
                collectionsLoaded: 0,
                environmentsLoaded: 0
            }
        }

        // Get auto-load status from server
        const statusResponse = await fetch('/api/auto-load/status')
        const status = await statusResponse.json()
        
        if (!status.initialized) {
            console.log('Auto-load not initialized on server')
            return {
                success: true,
                collectionsLoaded: 0,
                environmentsLoaded: 0
            }
        }

        // Get cached objects from server
        const objectsResponse = await fetch('/api/auto-load/objects')
        if (!objectsResponse.ok) {
            console.log('No cached objects available')
            return {
                success: true,
                collectionsLoaded: 0,
                environmentsLoaded: 0
            }
        }

        const { collections, environments } = await objectsResponse.json()
        
        // Process collections
        if (collections && collections.length > 0) {
            for (const fileContent of collections) {
                try {
                    const result = await processImportFile(
                        fileContent, 
                        config.DEFAULT_IMPORT_TYPE, 
                        workspaceId
                    )
                    
                    allCollectionTree = allCollectionTree.concat(result.collectionTree)
                    allPlugins = allPlugins.concat(result.plugins)
                    
                    if (result.environments && result.environments.length > 0) {
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
        
        // Process environments
        if (environments && environments.length > 0) {
            for (const fileContent of environments) {
                try {
                    const envData = Array.isArray(fileContent.content) 
                        ? fileContent.content 
                        : [fileContent.content]
                    
                    if (config.MERGE_ENVIRONMENTS) {
                        activeWorkspace.environments = mergeArraysByProperty(
                            activeWorkspace.environments ?? [], 
                            envData, 
                            'name'
                        )
                    } else {
                        activeWorkspace.environments = envData
                    }
                    
                    await store.commit('updateWorkspaceEnvironments', {
                        workspaceId: workspaceId,
                        environments: activeWorkspace.environments
                    })
                    
                    totalEnvironmentsLoaded += envData.length
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
                if (Array.isArray(postmanResult)) {
                    collectionTree = postmanResult
                    plugins = []
                } else {
                    collectionTree = postmanResult.collection
                    plugins = postmanResult.plugins || []
                }
                break
                
            case 'Insomnia':
                collectionTree = convertInsomniaExportToRestfoxCollection(content, workspaceId)
                break
                
            case 'Restfox':
                console.log('Restfox', content)
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