/**
 * File Upload - Main Entry Point
 * Pure orchestrator that initializes UI event handlers
 */

import { $ } from '../../utils/dom.js';
import { handleFileList } from './file-router.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize file upload handlers for UI events
 */
export function initFileHandlers() {
    const fileUploadBtn = $("#fileUploadBtn");
    const dropZone = $("#dropZone");
    const fileInput = $("#fileInput");

    if (!fileUploadBtn || !dropZone || !fileInput) {
        console.warn("File upload UI elements not found, file upload disabled");
        return;
    }

    const triggerFileInput = () => fileInput.click();

    const handleDragEvent = (e, addClass) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.toggle("dragover", addClass);
    };

    fileUploadBtn.addEventListener("click", triggerFileInput);
    dropZone.addEventListener("click", triggerFileInput);

    fileInput.addEventListener("change", (e) => {
        if (!e.target.files?.length) return;
        handleFileList(e.target.files);
        e.target.value = "";
    });

    dropZone.addEventListener("dragenter", (e) => handleDragEvent(e, true));
    dropZone.addEventListener("dragover", (e) => handleDragEvent(e, true));
    dropZone.addEventListener("dragleave", (e) => handleDragEvent(e, false));

    dropZone.addEventListener("drop", (e) => {
        handleDragEvent(e, false);
        const files = e.dataTransfer.files;
        if (files?.length) handleFileList(files);
    });
}
