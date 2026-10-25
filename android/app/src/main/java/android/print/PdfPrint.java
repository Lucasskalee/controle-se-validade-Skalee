package android.print;

import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.File;

/**
 * Utilitário ponte para conversão de PrintDocumentAdapter em arquivo PDF físico.
 * Reside deliberadamente no pacote 'android.print' para ter visibilidade de pacote
 * dos construtores de LayoutResultCallback e WriteResultCallback do Android SDK.
 */
public class PdfPrint {
    private static final String TAG = "SkaleePrinter:PdfPrint";
    private final PrintAttributes printAttributes;

    public interface Callback {
        void onSuccess(File file, int pageCount, long elapsedMs);
        void onError(String message, Throwable cause);
    }

    public PdfPrint(PrintAttributes printAttributes) {
        if (printAttributes != null && printAttributes.getResolution() == null) {
            PrintAttributes.Builder safeBuilder = new PrintAttributes.Builder();
            safeBuilder.setColorMode(printAttributes.getColorMode());
            if (printAttributes.getMediaSize() != null) {
                safeBuilder.setMediaSize(printAttributes.getMediaSize());
            } else {
                safeBuilder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait());
            }
            if (printAttributes.getMinMargins() != null) {
                safeBuilder.setMinMargins(printAttributes.getMinMargins());
            }
            safeBuilder.setResolution(new PrintAttributes.Resolution("skalee_pdf", "Skalee PDF", 300, 300));
            this.printAttributes = safeBuilder.build();
        } else {
            this.printAttributes = printAttributes;
        }
    }

    public void print(final PrintDocumentAdapter adapter, final File outputFile, final Callback callback) {
        final long startTime = System.currentTimeMillis();
        Log.i(TAG, "Iniciando ciclo de impressão para PDF em arquivo: " + outputFile.getAbsolutePath());

        try {
            // 1. OBRIGATÓRIO: Iniciar a sessão de impressão no Chromium
            Log.i(TAG, "Chamando adapter.onStart()...");
            adapter.onStart();

            final CancellationSignal layoutSignal = new CancellationSignal();

            Log.i(TAG, "Chamando adapter.onLayout()...");
            adapter.onLayout(
                null,
                printAttributes,
                layoutSignal,
                new PrintDocumentAdapter.LayoutResultCallback() {
                    @Override
                    public void onLayoutFinished(final PrintDocumentInfo info, boolean changed) {
                        final long layoutElapsed = System.currentTimeMillis() - startTime;
                        final int pageCount = info != null ? info.getPageCount() : 1;
                        Log.i(TAG, "onLayoutFinished disparado! páginas=" + pageCount + ", mudou=" + changed + " (t=" + layoutElapsed + "ms)");

                        ParcelFileDescriptor pfd = null;
                        try {
                            if (outputFile.exists()) {
                                outputFile.delete();
                            }
                            if (outputFile.getParentFile() != null && !outputFile.getParentFile().exists()) {
                                outputFile.getParentFile().mkdirs();
                            }
                            outputFile.createNewFile();
                            pfd = ParcelFileDescriptor.open(outputFile, ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE);
                        } catch (Throwable e) {
                            Log.e(TAG, "Erro ao criar ParcelFileDescriptor para PDF: " + e.getMessage(), e);
                            try { adapter.onFinish(); } catch (Throwable ignored) {}
                            callback.onError("Falha ao criar descritor do arquivo PDF: " + e.getMessage(), e);
                            return;
                        }

                        final ParcelFileDescriptor finalPfd = pfd;
                        final CancellationSignal writeSignal = new CancellationSignal();

                        Log.i(TAG, "Chamando adapter.onWrite() para " + pageCount + " página(s)...");
                        adapter.onWrite(
                            new PageRange[]{PageRange.ALL_PAGES},
                            finalPfd,
                            writeSignal,
                            new PrintDocumentAdapter.WriteResultCallback() {
                                @Override
                                public void onWriteFinished(PageRange[] pages) {
                                    final long writeElapsed = System.currentTimeMillis() - startTime;
                                    Log.i(TAG, "onWriteFinished disparado com sucesso! (t=" + writeElapsed + "ms)");
                                    try {
                                        finalPfd.close();
                                    } catch (Throwable e) {
                                        Log.w(TAG, "Aviso ao fechar ParcelFileDescriptor: " + e.getMessage());
                                    }
                                    try {
                                        adapter.onFinish();
                                    } catch (Throwable e) {
                                        Log.w(TAG, "Aviso ao finalizar adapter.onFinish(): " + e.getMessage());
                                    }
                                    callback.onSuccess(outputFile, pageCount, writeElapsed);
                                }

                                @Override
                                public void onWriteFailed(CharSequence errorSequence) {
                                    final long failElapsed = System.currentTimeMillis() - startTime;
                                    Log.e(TAG, "onWriteFailed: " + errorSequence + " (t=" + failElapsed + "ms)");
                                    try { finalPfd.close(); } catch (Throwable ignored) {}
                                    try { adapter.onFinish(); } catch (Throwable ignored) {}
                                    callback.onError(errorSequence != null ? errorSequence.toString() : "Falha na escrita do PDF", null);
                                }

                                @Override
                                public void onWriteCancelled() {
                                    final long cancelElapsed = System.currentTimeMillis() - startTime;
                                    Log.w(TAG, "onWriteCancelled disparado (t=" + cancelElapsed + "ms)");
                                    try { finalPfd.close(); } catch (Throwable ignored) {}
                                    try { adapter.onFinish(); } catch (Throwable ignored) {}
                                    callback.onError("Geração de PDF cancelada durante a escrita.", null);
                                }
                            }
                        );
                    }

                    @Override
                    public void onLayoutFailed(CharSequence errorSequence) {
                        final long failElapsed = System.currentTimeMillis() - startTime;
                        Log.e(TAG, "onLayoutFailed: " + errorSequence + " (t=" + failElapsed + "ms)");
                        try { adapter.onFinish(); } catch (Throwable ignored) {}
                        callback.onError(errorSequence != null ? errorSequence.toString() : "Falha no cálculo de layout do documento PDF", null);
                    }

                    @Override
                    public void onLayoutCancelled() {
                        final long cancelElapsed = System.currentTimeMillis() - startTime;
                        Log.w(TAG, "onLayoutCancelled disparado (t=" + cancelElapsed + "ms)");
                        try { adapter.onFinish(); } catch (Throwable ignored) {}
                        callback.onError("Cálculo de layout do PDF cancelado.", null);
                    }
                },
                new Bundle()
            );
        } catch (Throwable e) {
            Log.e(TAG, "Exceção fatal no ciclo PdfPrint: " + e.getMessage(), e);
            try { adapter.onFinish(); } catch (Throwable ignored) {}
            callback.onError("Exceção no ciclo de impressão: " + e.getMessage(), e);
        }
    }
}
