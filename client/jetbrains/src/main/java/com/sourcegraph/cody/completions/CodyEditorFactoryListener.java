package com.sourcegraph.cody.completions;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.CommandProcessor;
import com.intellij.openapi.editor.Caret;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.SelectionModel;
import com.intellij.openapi.editor.VisualPosition;
import com.intellij.openapi.editor.event.*;
import com.intellij.openapi.editor.ex.util.EditorUtil;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.VirtualFile;
import com.sourcegraph.agent.CodyAgent;
import com.sourcegraph.agent.protocol.Position;
import com.sourcegraph.agent.protocol.Range;
import com.sourcegraph.agent.protocol.TextDocument;
import com.sourcegraph.cody.vscode.InlineCompletionTriggerKind;
import java.util.List;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/**
 * Determines when to trigger completions and when to clear completions.
 *
 * <p>IntelliJ doesn't have a built-in API to register "inline completion providers" similar to VS
 * Code. Instead, we manually listen to editor events like the caret position, selection changes,
 * and document edits.
 */
public class CodyEditorFactoryListener implements EditorFactoryListener {
  CodySelectionListener selectionListener = new CodySelectionListener();
  CaretListener caretListener = new CodyCaretListener();

  private static void onEditorChanged(Editor editor) {
    if (CodyAgent.isConnected()) {
      VirtualFile file = FileDocumentManager.getInstance().getFile(editor.getDocument());
      if (file == null) {
        return;
      }
      CodyAgent.getServer()
          .textDocumentDidChange(
              new TextDocument()
                  .setFilePath(file.getPath())
                  .setContent(editor.getDocument().getText())
                  .setSelection(getSelection(editor)));
    }
  }

  @Nullable
  private static Range getSelection(Editor editor) {
    SelectionModel selectionModel = editor.getSelectionModel();
    VisualPosition selectionStartPosition = selectionModel.getSelectionStartPosition();
    VisualPosition selectionEndPosition = selectionModel.getSelectionEndPosition();
    if (selectionStartPosition != null && selectionEndPosition != null) {
      return new Range()
          .setStart(
              new Position()
                  .setLine(selectionStartPosition.line)
                  .setCharacter(selectionStartPosition.column))
          .setEnd(
              new Position()
                  .setLine(selectionEndPosition.line)
                  .setCharacter(selectionEndPosition.column));
    }
    List<Caret> carets = editor.getCaretModel().getAllCarets();
    if (carets.size() > 0) {
      Caret caret = carets.get(0);
      Position position =
          new Position()
              .setLine(caret.getLogicalPosition().line)
              .setCharacter(caret.getLogicalPosition().column);
      // A single-offset caret is a selection where end == start.
      return new Range().setStart(position).setEnd(position);
    }
    return null;
  }

  public CodyEditorFactoryListener() {
    // TODO: start the agent somewhere else, for example based on application lifecycle events
    ApplicationManager.getApplication().invokeLater(CodyAgent::run);
  }

  @Override
  public void editorCreated(@NotNull EditorFactoryEvent event) {
    Editor editor = event.getEditor();
    onEditorChanged(editor);
    Project project = editor.getProject();
    if (project == null || project.isDisposed()) {
      return;
    }
    Disposable disposable = Disposer.newDisposable("CodyEditorFactoryListener");
    EditorUtil.disposeWithEditor(editor, disposable);
    editor.getCaretModel().addCaretListener(this.caretListener, disposable);
    editor.getSelectionModel().addSelectionListener(this.selectionListener, disposable);
    editor.getDocument().addDocumentListener(new CodyDocumentListener(editor), disposable);
  }

  private static class CodyCaretListener implements CaretListener {

    @Override
    public void caretPositionChanged(@NotNull CaretEvent e) {
      onEditorChanged(e.getEditor());
      CodyCompletionsManager suggestions = CodyCompletionsManager.getInstance();
      if (suggestions.isEnabledForEditor(e.getEditor())
          && CodyEditorFactoryListener.isSelectedEditor(e.getEditor())) {
        suggestions.clearCompletions(e.getEditor());
        suggestions.triggerCompletion(e.getEditor(), e.getEditor().getCaretModel().getOffset());
      }
    }
  }

  private static class CodySelectionListener implements SelectionListener {
    @Override
    public void selectionChanged(@NotNull SelectionEvent e) {
      if (CodyCompletionsManager.getInstance().isEnabledForEditor(e.getEditor())
          && CodyEditorFactoryListener.isSelectedEditor(e.getEditor())) {
        onEditorChanged(e.getEditor());
        ApplicationManager.getApplication()
            .getService(CodyCompletionsManager.class)
            .clearCompletions(e.getEditor());
      }
    }
  }

  private static class CodyDocumentListener implements BulkAwareDocumentListener {
    private final Editor editor;

    public CodyDocumentListener(Editor editor) {
      this.editor = editor;
    }

    public void documentChangedNonBulk(@NotNull DocumentEvent event) {
      if (!CodyEditorFactoryListener.isSelectedEditor(this.editor)) {
        return;
      }
      CodyCompletionsManager completions = CodyCompletionsManager.getInstance();
      completions.clearCompletions(this.editor);
      if (completions.isEnabledForEditor(this.editor)
          && !CommandProcessor.getInstance().isUndoTransparentActionInProgress()) {
        onEditorChanged(this.editor);
        int changeOffset = event.getOffset() + event.getNewLength();
        if (this.editor.getCaretModel().getOffset() == changeOffset) {
          InlineCompletionTriggerKind requestType =
              event.getOldLength() != event.getNewLength()
                  ? InlineCompletionTriggerKind.Invoke
                  : InlineCompletionTriggerKind.Automatic;
          completions.triggerCompletion(this.editor, changeOffset);
        }
      }
    }
  }

  /**
   * Returns true if this editor is currently open and focused by the user. Returns true if this
   * editor is in a separate tab or not focused/selected by the user.
   */
  private static boolean isSelectedEditor(Editor editor) {
    if (editor == null) {
      return false;
    }
    Project project = editor.getProject();
    if (project == null || project.isDisposed()) {
      return false;
    }
    FileEditorManager editorManager = FileEditorManager.getInstance(project);
    if (editorManager == null) {
      return false;
    }
    if (editorManager instanceof FileEditorManagerImpl) {
      Editor current = ((FileEditorManagerImpl) editorManager).getSelectedTextEditor(true);
      return current != null && current.equals(editor);
    }
    FileEditor current = editorManager.getSelectedEditor();
    return current instanceof TextEditor && editor.equals(((TextEditor) current).getEditor());
  }
}
