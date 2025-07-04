import { readFile, mkdir, writeFile } from 'fs/promises'
import { load as yamlLoad } from 'js-yaml'
import { join } from 'path'

const CACHE_DIR = '.auto-load-cache'

export async function loadConfiguredObjects(configPath) {
    try {
        // Read and parse the YAML config file
        const yamlContent = await readFile(configPath, 'utf8')
        const config = yamlLoad(yamlContent)
        
        if (!config || typeof config !== 'object') {
            console.warn('Invalid config file format')
            return null
        }

        const result = {
            collections: [],
            environments: []
        }
        
        let response
        let attempts
        // Load collections
        if (config.collections && Array.isArray(config.collections)) {
            for (const filePath of config.collections) {
                try {
                    attempts = 0
                    const maxAttempts = 60 // 1 minute with 1 second intervals
                    
                    while (attempts < maxAttempts) {
                        try {
                            response = await fetch(filePath)
                            if (response.ok) {
                                break
                            }
                        } catch (error) {
                            console.log(`Attempt ${attempts + 1} failed for ${filePath}:`, error.message)
                        }
                        
                        attempts++
                        if (attempts < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second before retry
                        }
                    }
                    
                    if (!response || !response.ok) {
                        throw new Error(`Failed to fetch ${filePath} after ${maxAttempts} attempts`)
                    }
                    if (!response.ok) {
                        throw new Error(`Failed to fetch ${filePath}: ${response.status} ${response.statusText}`)
                    }
                    const content = await response.text()
                    //console.log("server side loaded collection")
                    //console.log(content)
                    const fileContent = JSON.parse(content)
                    result.collections.push({
                        name: filePath.split('/').pop(),
                        content: fileContent
                    })
                } catch (error) {
                    console.error(`Failed to load collection from ${filePath}:`, error)
                }
            }
        }

        // Load environments
        if (config.environments && Array.isArray(config.environments)) {
            for (const filePath of config.environments) {
                try {
                    attempts = 0
                    const maxAttempts = 60 // 1 minute with 1 second intervals
                    
                    while (attempts < maxAttempts) {
                        try {
                            response = await fetch(filePath)
                            if (response.ok) {
                                break
                            }
                        } catch (error) {
                            console.log(`Attempt ${attempts + 1} failed for ${filePath}:`, error.message)
                        }
                        
                        attempts++
                        if (attempts < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second before retry
                        }
                    }
                    
                    if (!response || !response.ok) {
                        throw new Error(`Failed to fetch ${filePath} after ${maxAttempts} attempts`)
                    }
                    if (!response.ok) {
                        throw new Error(`Failed to fetch ${filePath}: ${response.status} ${response.statusText}`)
                    }
                    const content = await response.text()
                    console.log("server side loaded environment")
                    console.log(content)
                    const fileContent = JSON.parse(content)
                    result.environments.push({
                        name: filePath.split('/').pop(),
                        content: fileContent
                    })
                } catch (error) {
                    console.error(`Failed to load environment from ${filePath}:`, error)
                }
            }
        }

        // Cache the loaded objects
        await cacheLoadedObjects(result)

        return result
    } catch (error) {
        console.error('Failed to load configured objects:', error)
        return null
    }
}

async function cacheLoadedObjects(objects) {
    try {
        // Create cache directory if it doesn't exist
        await mkdir(CACHE_DIR, { recursive: true })

        // Cache collections
        for (const collection of objects.collections) {
            const cachePath = join(CACHE_DIR, `collection-${collection.name}`)
            await writeFile(cachePath, JSON.stringify(collection.content))
        }

        // Cache environments
        for (const env of objects.environments) {
            const cachePath = join(CACHE_DIR, `env-${env.name}`)
            await writeFile(cachePath, JSON.stringify(env.content))
        }

        // Write a manifest file
        const manifest = {
            collections: objects.collections.map(c => ({ name: c.name })),
            environments: objects.environments.map(e => ({ name: e.name })),
            timestamp: new Date().toISOString()
        }
        await writeFile(join(CACHE_DIR, 'manifest.json'), JSON.stringify(manifest))
    } catch (error) {
        console.error('Failed to cache objects:', error)
    }
}

export async function getCachedObjects() {
    try {
        const manifestPath = join(CACHE_DIR, 'manifest.json')
        const manifestContent = await readFile(manifestPath, 'utf8')
        const manifest = JSON.parse(manifestContent)

        const result = {
            collections: [],
            environments: []
        }

        // Load cached collections
        for (const collection of manifest.collections) {
            const cachePath = join(CACHE_DIR, `collection-${collection.name}`)
            const content = await readFile(cachePath, 'utf8')
            result.collections.push({
                name: collection.name,
                content: JSON.parse(content)
            })
        }

        // Load cached environments
        for (const env of manifest.environments) {
            const cachePath = join(CACHE_DIR, `env-${env.name}`)
            const content = await readFile(cachePath, 'utf8')
            result.environments.push({
                name: env.name,
                content: JSON.parse(content)
            })
        }

        return result
    } catch (error) {
        console.error('Failed to get cached objects:', error)
        return null
    }
} 