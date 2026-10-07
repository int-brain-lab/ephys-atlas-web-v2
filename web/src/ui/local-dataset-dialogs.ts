import { element, heading, titleCaseToken, formatBytes } from './dom-helpers.js';
import type { LocalArchivePreview } from '../data/local-archive.js';
import type { LocalReleaseInspection, LocalStorageInspection } from '../data/local-source.js';
import type { DatasetId } from '../domain/types.js';

export interface LocalDatasetDialogsCallbacks {
  prepareLocal(file: File): Promise<LocalArchivePreview>;
  admitLocal(): Promise<void>;
  cancelLocal(): void;
  deleteLocal(selector: string): Promise<void>;
  inspectLocalStorage(): Promise<LocalStorageInspection>;
  verifyLocal(selector: string): Promise<LocalReleaseInspection>;
  selectLocalRelease(selector: string): void;
  copyLocalLink(): Promise<void>;
}

export interface LocalDatasetContext {
  readonly datasetId: DatasetId;
  readonly releaseId: string | null;
  readonly datasetTitle: string | null;
}

export class LocalDatasetDialogs {
  readonly elements: readonly HTMLElement[];

  private readonly localImportInput: HTMLInputElement;
  private readonly localImportDialog: HTMLDialogElement;
  private readonly localImportStatus: HTMLElement;
  private readonly localImportError: HTMLElement;
  private readonly localImportSummary: HTMLElement;
  private readonly localImportConfirm: HTMLButtonElement;
  private readonly localImportCancel: HTMLButtonElement;
  private readonly localDeleteDialog: HTMLDialogElement;
  private readonly localDeleteIdentity: HTMLElement;
  private readonly localDeleteError: HTMLElement;
  private readonly localDeleteConfirm: HTMLButtonElement;
  private readonly localManagerDialog: HTMLDialogElement;
  private readonly localManagerStatus: HTMLElement;
  private readonly localManagerError: HTMLElement;
  private readonly localManagerContent: HTMLElement;
  private readonly localShareDialog: HTMLDialogElement;
  private readonly localShareError: HTMLElement;
  private readonly localShareConfirm: HTMLButtonElement;
  private context: LocalDatasetContext | null = null;
  private pendingLocalDeleteSelector: string | null = null;
  private localDeleteCommitting = false;
  private localManagerSequence = 0;
  private localImportSequence = 0;
  private localImportActive = false;
  private localImportCommitting = false;
  private disposed = false;

  constructor(private readonly callbacks: LocalDatasetDialogsCallbacks) {
    const localImport = this.createLocalImportDialog();
    this.localImportDialog = localImport.dialog;
    this.localImportStatus = localImport.status;
    this.localImportError = localImport.error;
    this.localImportSummary = localImport.summary;
    this.localImportConfirm = localImport.confirm;
    this.localImportCancel = localImport.cancel;
    const localDelete = this.createLocalDeleteDialog();
    this.localDeleteDialog = localDelete.dialog;
    this.localDeleteIdentity = localDelete.identity;
    this.localDeleteError = localDelete.error;
    this.localDeleteConfirm = localDelete.confirm;
    const localManager = this.createLocalManagerDialog();
    this.localManagerDialog = localManager.dialog;
    this.localManagerStatus = localManager.status;
    this.localManagerError = localManager.error;
    this.localManagerContent = localManager.content;
    const localShare = this.createLocalShareDialog();
    this.localShareDialog = localShare.dialog;
    this.localShareError = localShare.error;
    this.localShareConfirm = localShare.confirm;
    this.localImportInput = element('input', 'local-import__input');
    this.localImportInput.type = 'file';
    this.localImportInput.accept = '.ibl-ephys-atlas.zip,application/zip';
    this.localImportInput.dataset.localImportInput = '';
    this.localImportInput.setAttribute('aria-label', 'Local dataset ZIP archive');
    this.localImportInput.hidden = true;
    this.localImportInput.addEventListener('change', () => {
      const file = this.localImportInput.files?.item(0);
      this.localImportInput.value = '';
      if (file && !this.disposed) void this.prepareLocalImport(file);
    });
    // Keep these as direct app children in AppShell's established dialog order.
    this.elements = [
      this.localImportDialog,
      this.localManagerDialog,
      this.localDeleteDialog,
      this.localShareDialog,
      this.localImportInput,
    ];
  }

  setContext(context: LocalDatasetContext): void {
    this.context = context;
  }

  openImportPicker(): void {
    if (!this.disposed) this.localImportInput.click();
  }

  openManager(): void {
    if (!this.disposed) void this.openLocalManager();
  }

  openDelete(selector?: string, label?: string): void {
    if (!this.disposed) this.openLocalDeleteDialog(selector, label);
  }

  openShare(): void {
    if (this.disposed) return;
    this.localShareError.hidden = true;
    this.localShareError.textContent = '';
    this.localShareConfirm.disabled = false;
    if (!this.localShareDialog.open) this.localShareDialog.showModal();
    this.localShareConfirm.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    const cancelImport = this.localImportActive && !this.localImportCommitting;
    this.disposed = true;
    this.localManagerSequence += 1;
    this.localImportSequence += 1;
    if (cancelImport) {
      this.callbacks.cancelLocal();
      if (this.localImportDialog.open) this.localImportDialog.close();
    }
    this.localImportActive = false;
  }

  private createLocalImportDialog(): {
    dialog: HTMLDialogElement;
    status: HTMLElement;
    error: HTMLElement;
    summary: HTMLElement;
    confirm: HTMLButtonElement;
    cancel: HTMLButtonElement;
  } {
    const dialog = element('dialog', 'info-dialog local-import');
    dialog.dataset.localImportDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-import-title');
    dialog.setAttribute('aria-describedby', 'local-import-note');

    const header = element('header', 'info-dialog__header');
    const title = heading('Import local dataset', 2);
    title.id = 'local-import-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.cancelLocalImport());
    header.append(title, close);

    const content = element('div', 'info-dialog__content local-import__content');
    const introduction = element('section', 'info-dialog__section');
    const note = element('p', 'local-import__note');
    note.id = 'local-import-note';
    note.textContent = 'The archive is validated and stored only in this browser on this device. Its contents are not uploaded.';
    const status = element('p', 'local-import__status');
    status.dataset.localImportStatus = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const error = element('p', 'download-dialog__error local-import__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    introduction.append(note, status, error);

    const summary = element('section', 'info-dialog__section local-import__summary');
    summary.dataset.localImportPreview = '';
    summary.hidden = true;

    const actions = element('footer', 'local-import__actions');
    const cancel = element('button', 'local-import__cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancelLocalImport());
    const confirm = element('button', 'local-import__confirm');
    confirm.type = 'button';
    confirm.textContent = 'Import';
    confirm.disabled = true;
    confirm.addEventListener('click', () => void this.admitLocalImport());
    actions.append(cancel, confirm);

    content.append(introduction, summary, actions);
    dialog.append(header, content);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.cancelLocalImport();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.cancelLocalImport();
    });
    return { dialog, status, error, summary, confirm, cancel };
  }

  private createLocalDeleteDialog(): {
    dialog: HTMLDialogElement;
    identity: HTMLElement;
    error: HTMLElement;
    confirm: HTMLButtonElement;
  } {
    const dialog = element('dialog', 'info-dialog local-delete');
    dialog.dataset.localDeleteDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-delete-title');
    dialog.setAttribute('aria-describedby', 'local-delete-note');
    const header = element('header', 'info-dialog__header');
    const title = heading('Delete local dataset', 2);
    title.id = 'local-delete-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.closeLocalDeleteDialog());
    header.append(title, close);

    const content = element('div', 'info-dialog__content local-delete__content');
    const section = element('section', 'info-dialog__section');
    const note = element('p', 'local-delete__note');
    note.id = 'local-delete-note';
    note.textContent = 'This removes the release and all of its resources from this browser on this device. It does not affect the source archive or published data.';
    const identity = element('p', 'local-delete__identity');
    identity.dataset.localDeleteIdentity = '';
    const error = element('p', 'download-dialog__error local-delete__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    section.append(note, identity, error);

    const actions = element('footer', 'local-import__actions');
    const cancel = element('button', 'local-import__cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeLocalDeleteDialog());
    const confirm = element('button', 'local-delete__confirm');
    confirm.type = 'button';
    confirm.textContent = 'Delete local dataset';
    confirm.addEventListener('click', () => void this.commitLocalDelete());
    actions.append(cancel, confirm);
    content.append(section, actions);
    dialog.append(header, content);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeLocalDeleteDialog();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.closeLocalDeleteDialog();
    });
    return { dialog, identity, error, confirm };
  }

  private createLocalManagerDialog(): {
    dialog: HTMLDialogElement;
    status: HTMLElement;
    error: HTMLElement;
    content: HTMLElement;
  } {
    const dialog = element('dialog', 'info-dialog local-manager');
    dialog.dataset.localManagerDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-manager-title');
    const header = element('header', 'info-dialog__header');
    const title = heading('Local datasets', 2);
    title.id = 'local-manager-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);

    const body = element('div', 'info-dialog__content local-manager__body');
    const introduction = element('section', 'info-dialog__section');
    const note = element('p', 'local-manager__note');
    note.textContent = 'These immutable releases are stored separately from published-data caches and remain only in this browser profile.';
    const status = element('p', 'local-manager__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const error = element('p', 'download-dialog__error local-manager__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    introduction.append(note, status, error);
    const content = element('section', 'local-manager__content');
    body.append(introduction, content);
    dialog.append(header, body);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    return { dialog, status, error, content };
  }

  private async openLocalManager(): Promise<void> {
    if (this.disposed) return;
    const sequence = ++this.localManagerSequence;
    this.localManagerStatus.textContent = 'Inspecting browser storage…';
    this.localManagerError.hidden = true;
    this.localManagerError.textContent = '';
    this.localManagerContent.replaceChildren();
    if (!this.localManagerDialog.open) this.localManagerDialog.showModal();
    try {
      const inspection = await this.callbacks.inspectLocalStorage();
      if (this.disposed || sequence !== this.localManagerSequence) return;
      this.renderLocalManager(inspection);
      this.localManagerStatus.textContent = inspection.releases.length
        ? `${inspection.releases.length.toLocaleString('en-US')} local release${inspection.releases.length === 1 ? '' : 's'}`
        : 'No local releases are stored.';
    } catch (error) {
      if (this.disposed || sequence !== this.localManagerSequence) return;
      this.localManagerStatus.textContent = 'Local browser storage could not be inspected.';
      this.localManagerError.textContent = error instanceof Error ? error.message : String(error);
      this.localManagerError.hidden = false;
    }
  }

  private renderLocalManager(inspection: LocalStorageInspection): void {
    const storage = element('section', 'local-manager__storage');
    storage.append(heading('Browser storage', 3));
    const storageDetails = element('dl', 'info-dialog__list local-manager__storage-list');
    const storageRows: (readonly [string, string])[] = [];
    if (inspection.usageBytes !== undefined) storageRows.push(['Site data in use', formatBytes(inspection.usageBytes)]);
    if (inspection.quotaBytes !== undefined) storageRows.push(['Estimated site quota', formatBytes(inspection.quotaBytes)]);
    storageRows.push(['Persistence', inspection.persisted === undefined
      ? 'Not reported by this browser'
      : inspection.persisted ? 'Granted' : 'Not granted; the browser may evict site data']);
    for (const [term, description] of storageRows) {
      const dt = element('dt');
      dt.textContent = term;
      const dd = element('dd');
      dd.textContent = description;
      storageDetails.append(dt, dd);
    }
    const caveat = element('p', 'local-manager__storage-note');
    caveat.textContent = 'Usage and quota are browser estimates for all data stored by this site, not just imported releases.';
    storage.append(storageDetails, caveat);

    const releases = element('section', 'local-manager__releases');
    releases.append(heading('Imported releases', 3));
    if (!inspection.releases.length) {
      const empty = element('p', 'local-manager__empty');
      empty.textContent = 'Use “Import local dataset…” to add a validated .ibl-ephys-atlas.zip archive.';
      releases.append(empty);
    } else {
      for (const release of inspection.releases) releases.append(this.localReleaseCard(release));
    }
    this.localManagerContent.replaceChildren(storage, releases);
  }

  private localReleaseCard(release: LocalReleaseInspection): HTMLElement {
    const card = element('article', 'local-manager__release');
    card.dataset.localRelease = release.selector;
    const title = heading(release.title, 3);
    const details = element('dl', 'info-dialog__list local-manager__release-list');
    const checked = release.integrityCheckedAt
      ? ` · checked ${this.formatLocalDate(release.integrityCheckedAt)}`
      : '';
    const integrity = release.integrityState === 'verified'
      ? `Verified${checked}`
      : release.integrityState === 'damaged'
        ? `Damaged${checked}`
        : 'Not verifiable; imported before integrity records were available';
    const rows: readonly (readonly [string, string])[] = [
      ['Source dataset', release.sourceDatasetId],
      ['Source release', release.sourceReleaseId],
      ['Local identity', release.selector],
      ['Imported', release.importedAt ? this.formatLocalDate(release.importedAt) : 'Not recorded'],
      ['Stored data', `${formatBytes(release.storedBytes)} · ${release.resourceCount.toLocaleString('en-US')} resource${release.resourceCount === 1 ? '' : 's'}`],
      ['Integrity', integrity],
    ];
    for (const [term, description] of rows) {
      const dt = element('dt');
      dt.textContent = term;
      const dd = element('dd');
      dd.textContent = description;
      details.append(dt, dd);
    }
    if (release.integrityMessage) {
      const problem = element('p', 'local-manager__integrity-error');
      problem.setAttribute('role', 'alert');
      problem.textContent = `${release.integrityMessage} Remove this damaged release, then import the source archive again.`;
      card.append(title, details, problem);
    } else {
      card.append(title, details);
    }

    const actions = element('div', 'local-manager__release-actions');
    const select = element('button', 'local-manager__select');
    select.type = 'button';
    select.textContent = 'Select';
    select.addEventListener('click', () => {
      this.callbacks.selectLocalRelease(release.selector);
      this.localManagerDialog.close();
    });
    const verify = element('button', 'local-manager__verify');
    verify.type = 'button';
    verify.textContent = 'Verify integrity';
    verify.disabled = release.integrityState === 'unverified';
    if (release.integrityState === 'unverified') verify.title = 'Reimport the source archive to enable complete integrity checks';
    verify.addEventListener('click', () => void this.verifyManagedRelease(release.selector, verify));
    const remove = element('button', 'local-manager__remove');
    remove.type = 'button';
    remove.textContent = release.integrityState === 'damaged' ? 'Remove damaged release…' : 'Delete…';
    remove.addEventListener('click', () => {
      this.localManagerDialog.close();
      this.openLocalDeleteDialog(release.selector, `${release.title} · ${release.selector}`);
    });
    actions.append(select, verify, remove);
    card.append(actions);
    return card;
  }

  private async verifyManagedRelease(selector: string, button: HTMLButtonElement): Promise<void> {
    if (this.disposed) return;
    button.disabled = true;
    this.localManagerStatus.textContent = `Verifying ${selector}…`;
    this.localManagerError.hidden = true;
    try {
      await this.callbacks.verifyLocal(selector);
      if (this.disposed) return;
      await this.openLocalManager();
    } catch (error) {
      if (this.disposed) return;
      this.localManagerStatus.textContent = `Could not verify ${selector}.`;
      this.localManagerError.textContent = error instanceof Error ? error.message : String(error);
      this.localManagerError.hidden = false;
      button.disabled = false;
    }
  }

  private formatLocalDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return value;
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private openLocalDeleteDialog(selector?: string, label?: string): void {
    const activeSelector = this.context?.datasetId === 'local' ? this.context.releaseId : null;
    const resolvedSelector = selector ?? activeSelector;
    if (!resolvedSelector) return;
    this.pendingLocalDeleteSelector = resolvedSelector;
    const datasetTitle = this.context?.datasetTitle;
    this.localDeleteIdentity.textContent = label ?? (datasetTitle && activeSelector === resolvedSelector
      ? `${datasetTitle} · ${resolvedSelector}`
      : resolvedSelector);
    this.localDeleteError.hidden = true;
    this.localDeleteError.textContent = '';
    this.localDeleteConfirm.disabled = false;
    if (!this.localDeleteDialog.open) this.localDeleteDialog.showModal();
    this.localDeleteConfirm.focus();
  }

  private closeLocalDeleteDialog(): void {
    if (this.localDeleteCommitting) return;
    this.pendingLocalDeleteSelector = null;
    if (this.localDeleteDialog.open) this.localDeleteDialog.close();
  }

  private async commitLocalDelete(): Promise<void> {
    const selector = this.pendingLocalDeleteSelector;
    if (!selector || this.localDeleteCommitting) return;
    this.localDeleteCommitting = true;
    this.localDeleteConfirm.disabled = true;
    this.localDeleteError.hidden = true;
    try {
      await this.callbacks.deleteLocal(selector);
      if (this.disposed) return;
      this.pendingLocalDeleteSelector = null;
      this.localDeleteDialog.close();
    } catch (error) {
      if (this.disposed) return;
      this.localDeleteError.textContent = error instanceof Error ? error.message : String(error);
      this.localDeleteError.hidden = false;
      this.localDeleteConfirm.disabled = false;
    } finally {
      this.localDeleteCommitting = false;
    }
  }

  private createLocalShareDialog(): {
    dialog: HTMLDialogElement;
    error: HTMLElement;
    confirm: HTMLButtonElement;
  } {
    const dialog = element('dialog', 'info-dialog local-share');
    dialog.dataset.localShareDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-share-title');
    dialog.setAttribute('aria-describedby', 'local-share-note');
    const header = element('header', 'info-dialog__header');
    const title = heading('Share local view', 2);
    title.id = 'local-share-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const content = element('div', 'info-dialog__content local-share__content');
    const section = element('section', 'info-dialog__section');
    const note = element('p', 'local-share__note');
    note.id = 'local-share-note';
    note.textContent = 'This link does not contain or transfer the dataset. It works only in a browser where the exact local release is already imported.';
    const error = element('p', 'download-dialog__error local-share__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    section.append(note, error);
    const actions = element('footer', 'local-import__actions');
    const cancel = element('button', 'local-import__cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const confirm = element('button', 'local-import__confirm');
    confirm.type = 'button';
    confirm.textContent = 'Copy local link';
    confirm.addEventListener('click', () => void this.confirmLocalShare());
    actions.append(cancel, confirm);
    content.append(section, actions);
    dialog.append(header, content);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    return { dialog, error, confirm };
  }

  private async confirmLocalShare(): Promise<void> {
    if (this.disposed) return;
    this.localShareConfirm.disabled = true;
    this.localShareError.hidden = true;
    try {
      await this.callbacks.copyLocalLink();
      if (this.disposed) return;
      this.localShareDialog.close();
    } catch (error) {
      if (this.disposed) return;
      this.localShareError.textContent = error instanceof Error ? error.message : String(error);
      this.localShareError.hidden = false;
    } finally {
      if (!this.disposed) this.localShareConfirm.disabled = false;
    }
  }

  private async prepareLocalImport(file: File): Promise<void> {
    if (this.disposed) return;
    const sequence = ++this.localImportSequence;
    this.localImportActive = true;
    this.localImportCommitting = false;
    this.localImportConfirm.disabled = true;
    this.localImportCancel.disabled = false;
    this.localImportSummary.hidden = true;
    this.localImportSummary.replaceChildren();
    this.localImportError.hidden = true;
    this.localImportError.textContent = '';
    this.localImportStatus.textContent = `Validating ${file.name}…`;
    if (!this.localImportDialog.open) this.localImportDialog.showModal();

    try {
      if (!file.name.toLocaleLowerCase('en-US').endsWith('.ibl-ephys-atlas.zip')) {
        throw new Error('Choose one .ibl-ephys-atlas.zip archive');
      }
      const preview = await this.callbacks.prepareLocal(file);
      if (this.disposed || sequence !== this.localImportSequence || !this.localImportActive) return;
      this.renderLocalImportPreview(file, preview);
      this.localImportStatus.textContent = 'Validation complete. Review the release before importing it.';
      this.localImportConfirm.disabled = false;
      this.localImportConfirm.focus();
    } catch (error) {
      if (this.disposed || sequence !== this.localImportSequence) return;
      this.callbacks.cancelLocal();
      this.localImportActive = false;
      this.localImportStatus.textContent = `Could not validate ${file.name}.`;
      this.localImportError.textContent = error instanceof Error ? error.message : String(error);
      this.localImportError.hidden = false;
    }
  }

  private renderLocalImportPreview(file: File, preview: LocalArchivePreview): void {
    const headingNode = heading(preview.title, 3);
    const details = element('dl', 'info-dialog__list local-import__list');
    const rows: readonly (readonly [string, string])[] = [
      ['Archive', file.name],
      ['Dataset', preview.datasetId],
      ['Release', preview.releaseId],
      ['Provenance', preview.provenanceSummary],
      ['Features', `${preview.featureCount.toLocaleString('en-US')} · ${preview.featureIds.join(', ')}`],
      ['Representations', preview.representations.map(titleCaseToken).join(', ') || 'None'],
      ['Parcellations', preview.parcellations.map(titleCaseToken).join(', ') || 'None'],
      ['Files', preview.fileCount.toLocaleString('en-US')],
      ['Archive size', formatBytes(preview.archiveBytes)],
      ['Stored size', formatBytes(preview.storedBytes)],
      ['Declared decoded size', formatBytes(preview.declaredDecodedBytes)],
    ];
    for (const [term, description] of rows) {
      const dt = element('dt');
      dt.textContent = term;
      const dd = element('dd');
      dd.textContent = description;
      details.append(dt, dd);
    }
    const identity = element('p', 'local-import__identity');
    identity.textContent = `Local identity: ${preview.selector}`;
    this.localImportSummary.replaceChildren(headingNode, details, identity);
    this.localImportSummary.hidden = false;
  }

  private async admitLocalImport(): Promise<void> {
    if (this.disposed || !this.localImportActive || this.localImportCommitting) return;
    this.localImportCommitting = true;
    this.localImportConfirm.disabled = true;
    this.localImportCancel.disabled = true;
    this.localImportStatus.textContent = 'Storing the validated release on this device…';
    this.localImportError.hidden = true;
    try {
      await this.callbacks.admitLocal();
      if (this.disposed) return;
      this.localImportActive = false;
      this.localImportStatus.textContent = 'Import complete.';
      this.localImportDialog.close();
    } catch (error) {
      if (this.disposed) return;
      this.localImportStatus.textContent = 'The validated release could not be stored.';
      this.localImportError.textContent = error instanceof Error ? error.message : String(error);
      this.localImportError.hidden = false;
      this.localImportConfirm.disabled = false;
      this.localImportCancel.disabled = false;
    } finally {
      this.localImportCommitting = false;
    }
  }

  private cancelLocalImport(): void {
    if (this.disposed || this.localImportCommitting) return;
    this.localImportSequence += 1;
    if (this.localImportActive) this.callbacks.cancelLocal();
    this.localImportActive = false;
    if (this.localImportDialog.open) this.localImportDialog.close();
  }

}
