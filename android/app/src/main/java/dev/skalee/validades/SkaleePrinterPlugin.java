package dev.skalee.validades;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.print.PdfPrint;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "SkaleePrinter")
public class SkaleePrinterPlugin extends Plugin {

    private static final String TAG = "SkaleePrinter";
    private static final long GENERATION_TIMEOUT_MS = 20000; // 20 segundos

    private WebView activeWebView;
    private File lastGeneratedPdfFile;

    private interface InternalPdfCallback {
        void onSuccess(File pdfFile, int pages, long totalElapsedMs);
        void onError(String message, Throwable cause);
    }

    private void logStep(String operation, String step, long startMs, String detail) {
        long elapsed = System.currentTimeMillis() - startMs;
        Log.i(TAG, "[" + operation + "][+" + elapsed + "ms] " + step + (detail != null ? ": " + detail : ""));
    }

    private void rejectCall(PluginCall call, String message, Throwable cause) {
        if (call == null) return;
        if (cause instanceof Exception) {
            call.reject(message, (Exception) cause);
        } else if (cause != null) {
            call.reject(message, new Exception(cause));
        } else {
            call.reject(message);
        }
    }

    private void cleanOldReports() {
        try {
            File reportsDir = new File(getContext().getCacheDir(), "reports");
            if (reportsDir.exists() && reportsDir.isDirectory()) {
                File[] files = reportsDir.listFiles();
                if (files != null) {
                    long now = System.currentTimeMillis();
                    for (File file : files) {
                        if (now - file.lastModified() > 2 * 60 * 60 * 1000 || files.length > 20) {
                            file.delete();
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}
    }

    private void cleanupWebView(final WebView webView) {
        if (webView == null) return;
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (webView.getParent() instanceof ViewGroup) {
                        ((ViewGroup) webView.getParent()).removeView(webView);
                    }
                    webView.stopLoading();
                    webView.destroy();
                    if (activeWebView == webView) {
                        activeWebView = null;
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "Aviso ao destruir WebView: " + t.getMessage());
                }
            }
        });
    }

    private void createPdfFileInternal(
            final String operationName,
            final String html,
            final String baseFileName,
            final String title,
            final boolean landscape,
            final InternalPdfCallback callback
    ) {
        final long opStart = System.currentTimeMillis();
        logStep(operationName, "Iniciando geração de PDF", opStart, "HTML length=" + (html != null ? html.length() : 0) + " chars");

        if (html == null || html.trim().isEmpty()) {
            callback.onError("Conteúdo HTML vazio para geração de relatório.", null);
            return;
        }

        cleanOldReports();

        final Handler mainHandler = new Handler(Looper.getMainLooper());
        final AtomicBoolean isDone = new AtomicBoolean(false);

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                WebView tempWebView = null;
                try {
                    final Activity activity = getActivity();
                    if (activity == null || activity.isFinishing()) {
                        callback.onError("Activity não disponível para renderização.", null);
                        return;
                    }

                    tempWebView = new WebView(activity);
                    activeWebView = tempWebView;
                    final WebView webView = tempWebView;

                    // Anexa a WebView de forma invisível à hierarquia da Activity com dimensões explícitas.
                    // Isso assegura que o motor de renderização do Chromium execute os passos de medição e
                    // layout sem suspender ou considerar a página órfã/descartável.
                    ViewGroup contentView = activity.findViewById(android.R.id.content);
                    if (contentView != null) {
                        int viewWidth = landscape ? 1122 : 794;
                        int viewHeight = landscape ? 794 : 1122;
                        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(viewWidth, viewHeight);
                        webView.setLayoutParams(lp);
                        webView.setVisibility(View.INVISIBLE);
                        contentView.addView(webView);
                        logStep(operationName, "WebView anexada à hierarquia (" + viewWidth + "x" + viewHeight + ", landscape=" + landscape + ")", opStart, null);
                    } else {
                        logStep(operationName, "Aviso: contentView nulo; renderizando fora da árvore", opStart, null);
                    }

                    webView.setBackgroundColor(Color.WHITE);

                    WebSettings settings = webView.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setLoadsImagesAutomatically(true);
                    settings.setDomStorageEnabled(true);
                    settings.setAllowFileAccess(true);
                    settings.setAllowContentAccess(true);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        settings.setForceDark(WebSettings.FORCE_DARK_OFF);
                    }

                    // Configura timeout de segurança
                    final Runnable timeoutRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (isDone.compareAndSet(false, true)) {
                                logStep(operationName, "TIMEOUT atingido (20s)", opStart, "Cancelando operação");
                                cleanupWebView(webView);
                                callback.onError("Tempo limite excedido na geração do PDF (20s).", null);
                            }
                        }
                    };
                    mainHandler.postDelayed(timeoutRunnable, GENERATION_TIMEOUT_MS);

                    webView.setWebViewClient(new WebViewClient() {
                        @Override
                        public boolean shouldOverrideUrlLoading(WebView view, String url) {
                            return false;
                        }

                        @Override
                        public void onPageFinished(final WebView view, String url) {
                            logStep(operationName, "onPageFinished recebido", opStart, "url=" + url);

                            // Aguarda 250ms para garantir estabilidade de fontes e imagens Base64
                            view.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    if (isDone.get()) return;

                                    try {
                                        File reportsDir = new File(getContext().getCacheDir(), "reports");
                                        if (!reportsDir.exists()) {
                                            reportsDir.mkdirs();
                                        }

                                        String safeName = (baseFileName != null && !baseFileName.trim().isEmpty() ? baseFileName : "relatorio_skalee")
                                                .replaceAll("[^a-zA-Z0-9_-]", "_");
                                        final File pdfFile = new File(reportsDir, safeName + "_" + System.currentTimeMillis() + ".pdf");

                                        PrintAttributes.Builder builder = new PrintAttributes.Builder();
                                        builder.setColorMode(PrintAttributes.COLOR_MODE_COLOR);
                                        if (landscape) {
                                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape());
                                        } else {
                                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait());
                                        }
                                        builder.setResolution(new PrintAttributes.Resolution("skalee_pdf", "Skalee PDF", 300, 300));
                                        builder.setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                                        PrintAttributes printAttributes = builder.build();

                                        String jobTitle = (title != null && !title.trim().isEmpty()) ? title : "Relatório Skalee";
                                        final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobTitle);

                                        logStep(operationName, "Disparando PdfPrint.print", opStart, "Arquivo alvo: " + pdfFile.getName());

                                        PdfPrint pdfPrint = new PdfPrint(printAttributes);
                                        pdfPrint.print(adapter, pdfFile, new PdfPrint.Callback() {
                                            @Override
                                            public void onSuccess(File file, int pageCount, long elapsedMs) {
                                                mainHandler.removeCallbacks(timeoutRunnable);
                                                if (isDone.compareAndSet(false, true)) {
                                                    logStep(operationName, "PdfPrint concluído com sucesso", opStart, "Páginas: " + pageCount + ", Tamanho: " + file.length() + " bytes");

                                                    // Validação de assinatura física %PDF-
                                                    boolean validHeader = false;
                                                    if (file.exists() && file.length() > 0) {
                                                        try (FileInputStream fis = new FileInputStream(file)) {
                                                            byte[] header = new byte[4];
                                                            int read = fis.read(header);
                                                            if (read >= 4 && header[0] == '%' && header[1] == 'P' && header[2] == 'D' && header[3] == 'F') {
                                                                validHeader = true;
                                                            }
                                                        } catch (Throwable t) {
                                                            Log.w(TAG, "Aviso ao verificar assinatura PDF: " + t.getMessage());
                                                        }
                                                    }

                                                    logStep(operationName, "Assinatura %PDF- validada", opStart, "Válido=" + validHeader);
                                                    lastGeneratedPdfFile = file;
                                                    cleanupWebView(webView);
                                                    callback.onSuccess(file, pageCount, System.currentTimeMillis() - opStart);
                                                }
                                            }

                                            @Override
                                            public void onError(String message, Throwable cause) {
                                                mainHandler.removeCallbacks(timeoutRunnable);
                                                if (isDone.compareAndSet(false, true)) {
                                                    logStep(operationName, "Erro em PdfPrint", opStart, message);
                                                    cleanupWebView(webView);
                                                    callback.onError(message, cause);
                                                }
                                            }
                                        });
                                    } catch (Throwable t) {
                                        mainHandler.removeCallbacks(timeoutRunnable);
                                        if (isDone.compareAndSet(false, true)) {
                                            logStep(operationName, "Exceção ao disparar PdfPrint", opStart, t.getMessage());
                                            cleanupWebView(webView);
                                            callback.onError("Erro na renderização do PDF: " + t.getMessage(), t);
                                        }
                                    }
                                }
                            }, 250);
                        }
                    });

                    logStep(operationName, "Carregando conteúdo HTML no WebView", opStart, null);
                    webView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);

                } catch (Throwable t) {
                    mainHandler.removeCallbacks(null);
                    if (isDone.compareAndSet(false, true)) {
                        logStep(operationName, "Exceção fatal na criação do WebView", opStart, t.getMessage());
                        cleanupWebView(tempWebView);
                        callback.onError("Erro ao inicializar WebView de conversão: " + t.getMessage(), t);
                    }
                }
            }
        });
    }

    @PluginMethod
    public void generatePdf(final PluginCall call) {
        final long callStart = System.currentTimeMillis();
        final String html = call.getString("html", "");
        final String title = call.getString("title", "Relatório Skalee");
        final String fileName = call.getString("fileName", "relatorio_skalee");
        final boolean landscape = call.getBoolean("landscape", true);

        createPdfFileInternal("generatePdf", html, fileName, title, landscape, new InternalPdfCallback() {
            @Override
            public void onSuccess(File pdfFile, int pages, long totalElapsedMs) {
                try {
                    Uri contentUri = FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".fileprovider",
                            pdfFile
                    );
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("path", pdfFile.getAbsolutePath());
                    ret.put("uri", contentUri.toString());
                    ret.put("fileName", pdfFile.getName());
                    ret.put("size", pdfFile.length());
                    ret.put("pages", pages);
                    ret.put("elapsedMs", totalElapsedMs);
                    logStep("generatePdf", "Retornando resolve ao JavaScript", callStart, "uri=" + contentUri);
                    call.resolve(ret);
                } catch (Throwable e) {
                    logStep("generatePdf", "Erro ao obter FileProvider URI", callStart, e.getMessage());
                    rejectCall(call, "Erro ao gerar link de acesso do PDF: " + e.getMessage(), e);
                }
            }

            @Override
            public void onError(String error, Throwable cause) {
                logStep("generatePdf", "Retornando reject ao JavaScript", callStart, error);
                call.reject(error, cause != null ? new Exception(cause) : null);
            }
        });
    }

    @PluginMethod
    public void sharePdf(final PluginCall call) {
        final long callStart = System.currentTimeMillis();
        final String html = call.getString("html", "");
        final String title = call.getString("title", "Relatório Skalee");
        final String fileName = call.getString("fileName", "relatorio_skalee");
        final boolean landscape = call.getBoolean("landscape", true);

        createPdfFileInternal("sharePdf", html, fileName, title, landscape, new InternalPdfCallback() {
            @Override
            public void onSuccess(File pdfFile, int pages, long totalElapsedMs) {
                try {
                    Uri contentUri = FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".fileprovider",
                            pdfFile
                    );

                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType("application/pdf");
                    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                    shareIntent.putExtra(Intent.EXTRA_TEXT, title + " - Skalee Validades");
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    Intent chooser = Intent.createChooser(shareIntent, "Compartilhar Relatório PDF");
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(chooser);

                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("path", pdfFile.getAbsolutePath());
                    ret.put("uri", contentUri.toString());
                    ret.put("pages", pages);
                    ret.put("elapsedMs", totalElapsedMs);
                    logStep("sharePdf", "Chooser disparado e resolve retornado ao JavaScript", callStart, null);
                    call.resolve(ret);
                } catch (Throwable e) {
                    logStep("sharePdf", "Erro ao abrir Intent chooser", callStart, e.getMessage());
                    rejectCall(call, "Erro ao compartilhar PDF: " + e.getMessage(), e);
                }
            }

            @Override
            public void onError(String error, Throwable cause) {
                logStep("sharePdf", "Retornando reject ao JavaScript", callStart, error);
                call.reject(error, cause != null ? new Exception(cause) : null);
            }
        });
    }

    @PluginMethod
    public void savePdf(final PluginCall call) {
        final long callStart = System.currentTimeMillis();
        final String html = call.getString("html", "");
        final String title = call.getString("title", "Relatório Skalee");
        final String fileName = call.getString("fileName", "relatorio_skalee");
        final boolean landscape = call.getBoolean("landscape", true);

        createPdfFileInternal("savePdf", html, fileName, title, landscape, new InternalPdfCallback() {
            @Override
            public void onSuccess(File pdfFile, int pages, long totalElapsedMs) {
                try {
                    lastGeneratedPdfFile = pdfFile;
                    String promptFileName = fileName.endsWith(".pdf") ? fileName : fileName + ".pdf";

                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/pdf");
                    intent.putExtra(Intent.EXTRA_TITLE, promptFileName);

                    logStep("savePdf", "Disparando ACTION_CREATE_DOCUMENT via startActivityForResult", callStart, "Título: " + promptFileName);
                    startActivityForResult(call, intent, "savePdfResult");
                } catch (Throwable e) {
                    logStep("savePdf", "Erro ao disparar ACTION_CREATE_DOCUMENT", callStart, e.getMessage());
                    rejectCall(call, "Erro ao iniciar seletor de arquivos: " + e.getMessage(), e);
                }
            }

            @Override
            public void onError(String error, Throwable cause) {
                logStep("savePdf", "Retornando reject ao JavaScript", callStart, error);
                call.reject(error, cause != null ? new Exception(cause) : null);
            }
        });
    }

    @ActivityCallback
    private void savePdfResult(PluginCall call, ActivityResult result) {
        final long callStart = System.currentTimeMillis();
        logStep("savePdfResult", "Recebido retorno da Activity de seleção de documento", callStart, "resultCode=" + result.getResultCode());

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri destUri = result.getData().getData();
            if (destUri != null && lastGeneratedPdfFile != null && lastGeneratedPdfFile.exists()) {
                try (InputStream is = new FileInputStream(lastGeneratedPdfFile);
                     OutputStream os = getContext().getContentResolver().openOutputStream(destUri, "wt")) {
                    byte[] buf = new byte[8192];
                    int len;
                    long bytesCopied = 0;
                    while ((len = is.read(buf)) > 0) {
                        os.write(buf, 0, len);
                        bytesCopied += len;
                    }
                    os.flush();

                    logStep("savePdfResult", "Arquivo copiado com sucesso para Uri", callStart, "Bytes: " + bytesCopied + ", uri=" + destUri);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("savedUri", destUri.toString());
                    ret.put("bytesWritten", bytesCopied);
                    ret.put("cancelled", false);
                    call.resolve(ret);
                    return;
                } catch (Throwable e) {
                    logStep("savePdfResult", "Erro ao copiar bytes para destino", callStart, e.getMessage());
                    rejectCall(call, "Falha ao salvar PDF no destino escolhido: " + e.getMessage(), e);
                    return;
                }
            }
        }

        // Usuário cancelou ou fechou o seletor de documentos
        logStep("savePdfResult", "Operação cancelada pelo usuário", callStart, null);
        JSObject ret = new JSObject();
        ret.put("success", false);
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void printHtml(final PluginCall call) {
        final long callStart = System.currentTimeMillis();
        final String html = call.getString("html", "");
        final String title = call.getString("title", "Relatório Skalee");
        final boolean landscape = call.getBoolean("landscape", true);

        if (html == null || html.trim().isEmpty()) {
            call.reject("Conteúdo HTML vazio para impressão.");
            return;
        }

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final WebView webView = new WebView(getActivity());
                    activeWebView = webView;

                    webView.setBackgroundColor(Color.WHITE);

                    WebSettings settings = webView.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setLoadsImagesAutomatically(true);
                    settings.setDomStorageEnabled(true);
                    settings.setAllowFileAccess(true);
                    settings.setAllowContentAccess(true);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        settings.setForceDark(WebSettings.FORCE_DARK_OFF);
                    }

                    webView.setWebViewClient(new WebViewClient() {
                        @Override
                        public boolean shouldOverrideUrlLoading(WebView view, String url) {
                            return false;
                        }

                        @Override
                        public void onPageFinished(final WebView view, String url) {
                            view.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    try {
                                        PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                                        if (printManager == null) {
                                            call.reject("Serviço de impressão não disponível no dispositivo.");
                                            return;
                                        }

                                        String jobName = title + " - Skalee";
                                        PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter(jobName);

                                        PrintAttributes.Builder builder = new PrintAttributes.Builder();
                                        builder.setColorMode(PrintAttributes.COLOR_MODE_COLOR);
                                        if (landscape) {
                                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape());
                                        } else {
                                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait());
                                        }
                                        builder.setResolution(new PrintAttributes.Resolution("skalee_pdf", "Skalee PDF", 300, 300));
                                        builder.setMinMargins(PrintAttributes.Margins.NO_MARGINS);

                                        printManager.print(jobName, printAdapter, builder.build());

                                        logStep("printHtml", "PrintManager acionado com sucesso", callStart, "Job: " + jobName);
                                        JSObject ret = new JSObject();
                                        ret.put("success", true);
                                        call.resolve(ret);
                                    } catch (Throwable e) {
                                        logStep("printHtml", "Erro ao acionar PrintManager", callStart, e.getMessage());
                                        rejectCall(call, "Falha ao invocar o gerenciador de impressão: " + e.getMessage(), e);
                                    }
                                }
                            }, 250);
                        }
                    });

                    logStep("printHtml", "Carregando HTML na WebView de impressão", callStart, null);
                    webView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
                } catch (Throwable e) {
                    logStep("printHtml", "Erro ao inicializar WebView para printHtml", callStart, e.getMessage());
                    rejectCall(call, "Erro ao preparar documento para impressão: " + e.getMessage(), e);
                }
            }
        });
    }
}
