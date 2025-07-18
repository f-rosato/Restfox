import express from 'express'
import { fetch, Agent } from 'undici'
import multer from 'multer'
import { loadConfiguredObjects, getCachedObjects } from './auto-load.js'

const app = express()

const port = process.env.PORT || 4004

// Initialize auto-load on server start
let autoLoadedObjects = null
async function initializeAutoLoad() {
    console.log('Initializing auto-load...')
    autoLoadedObjects = await loadConfiguredObjects('/app/web-standalone/public/collections-envs.yaml')
    if (autoLoadedObjects) {
        console.log('Auto-load initialized successfully')
    } else {
        console.log('Auto-load initialization failed or no config found')
    }
}
initializeAutoLoad()

app.use(express.static('public'))

const upload = multer()

app.use((req, res, next) => {
    if (req.is('multipart/*')) {
        upload.any()(req, res, next)
    } else {
        express.raw({ type: '*/*' })(req, res, next)
    }
})

// Add auto-load endpoints
app.get('/api/auto-load/status', (req, res) => {
    res.json({
        initialized: autoLoadedObjects !== null,
        hasCollections: autoLoadedObjects?.collections?.length > 0,
        hasEnvironments: autoLoadedObjects?.environments?.length > 0
    })
})

app.get('/api/auto-load/objects', async (req, res) => {
    const objects = await getCachedObjects()
    if (!objects) {
        res.status(404).json({ error: 'No cached objects found' })
        return
    }
    res.json(objects)
})

app.post('/api/auto-load/reload', async (req, res) => {
    try {
        autoLoadedObjects = await loadConfiguredObjects('/app/web-standalone/public/collections-envs.yaml')
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: 'Failed to reload auto-load objects' })
    }
})

const agents = new Map()

function getAgentForRequest(urlParsed, disableSSLVerification) {
    const key = `${urlParsed.hostname}:${urlParsed.port}:${disableSSLVerification}`

    if(!agents.has(key)) {
        const agent = new Agent({
            connect: {
                rejectUnauthorized: disableSSLVerification ? false : true,
            },
            allowH2: true,
        })

        agents.set(key, agent)
    }

    return agents.get(key)
}

app.post('/proxy', async(req, res) => {
    const disableSSLVerification = req.headers['x-proxy-flag-disable-ssl-verification'] === 'true'
    const url = req.headers['x-proxy-req-url']
    const method = req.headers['x-proxy-req-method']
    const headers = {}
    let body

    const agent = getAgentForRequest(new URL(url), disableSSLVerification)

    if (req.is('multipart/*')) {
        const files = req.files

        body = new FormData()

        Object.keys(files).forEach(field => {
            const file = files[field]
            const blob = new Blob([file.buffer], { type: file.mimetype })
            body.append(file.fieldname, blob, file.originalname)
        })
    } else {
        body = req.body
    }

    Object.keys(req.headers).forEach(header => {
        if(header.startsWith('x-proxy-req-header-')) {
            headers[header.replace('x-proxy-req-header-', '')] = req.headers[header]
        }
    })

    try {
        const startTime = new Date()

        const response = await fetch(url, {
            dispatcher: agent,
            method,
            headers,
            body: method !== 'GET' ? body : undefined
        })

        const headEndTime = new Date()

        const status = response.status
        const statusText = response.statusText
        const responseHeaders = [...response.headers.entries()]

        const responseBlob = await response.blob()

        const endTime = new Date()

        const mimeType = responseBlob.type
        const buffer = await responseBlob.arrayBuffer()

        const timeTaken = endTime - startTime
        const headTimeTaken = headEndTime - startTime
        const bodyTimeTaken = endTime - headEndTime

        const responseToSend = {
            status,
            statusText,
            headers: responseHeaders,
            mimeType,
            buffer: Array.from(new Uint8Array(buffer)),
            timeTaken,
            headTimeTaken,
            bodyTimeTaken,
        }

        res.send({
            event: 'response',
            eventData: responseToSend
        })
    } catch(e) {
        res.send({
            event: 'responseError',
            eventData: e.message
        })
    }
})

app.listen(port, () => {
    console.log(`Restfox running on port http://localhost:${port}`)
})
