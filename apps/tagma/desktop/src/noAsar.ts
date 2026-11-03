//! Electron's fs reads an .asar file as a folder, so a bundle holding one would never be wholly removed
process.noAsar = true;
