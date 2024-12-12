const { dialog, shell } = require('electron')
const fileUtils = require('./file-utils')
const fs = require('fs').promises
const path = require('path')

const LOG_ONLY_METHOD_NAME = true
const LOG_ONLY_METHOD_NAME_EXCEPT = []

function logMethodCall(methodName, args) {
    if (LOG_ONLY_METHOD_NAME && !LOG_ONLY_METHOD_NAME_EXCEPT.includes(methodName)) {
        console.log(methodName)
        return
    }
    console.log(methodName, args)
}

async function openFolderSelectionDialog() {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    })

    if (result.canceled) {
        return null
    }

    return result.filePaths[0]
}

async function openFolder(path) {
    await shell.openPath(path)
}

async function readFile(filePath, workspaceLocation = null) {
    logMethodCall('readFile', { filePath, workspaceLocation })

    let filePathResolved = ''
    let filePathExists = false

    if (workspaceLocation !== null) {
        filePathResolved = path.resolve(path.join(workspaceLocation, filePath))
        filePathExists = await fileUtils.pathExists(filePathResolved)
    }

    if (!filePathExists) {
        filePathResolved = path.resolve(filePath)
        filePathExists = await fileUtils.pathExists(filePathResolved)
    }

    if (!filePathExists) {
        return {
            error: `Cannot find file: ${filePathResolved}`,
            content: null,
        }
    }

    try {
        const content = await fs.readFile(filePathResolved, 'utf8')

        return {
            error: null,
            content,
        }
    } catch (error) {
        console.error(error)
        return {
            error: error.message + ' ' + filePathResolved,
            content: null,
        }
    }
}

function removePrefixFromString(str, prefix) {
    if (str.startsWith(prefix)) {
        return str.slice(prefix.length)
    }
    return str
}

module.exports = {
    openFolderSelectionDialog,
    openFolder,
    readFile,
    removePrefixFromString,
}
