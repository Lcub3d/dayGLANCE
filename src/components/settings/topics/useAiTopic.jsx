// Settings: the AI Features topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React, { useState } from 'react';
import { BarChart3, BrainCircuit, CalendarDays, CheckSquare, ExternalLink, Key, Loader, Mic, Moon, Server, Sparkles, Sun, Wifi, WifiOff, Zap } from 'lucide-react';
import SettingsCard from '../SettingsCard.jsx';
import { testConnection, fetchProviderModels, PROVIDER_MODELS, PROVIDER_LABELS, aiHasCredentials } from '../../../ai.js';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../../context/FeaturesContext.jsx';

export default function useAiTopic() {
  const { t } = useTranslation();
  const {
    darkMode, borderClass, textPrimary, textSecondary, setOnboardingProgress,
  } = useDayPlannerCtx();
  const {
    aiConfig, setAiConfig, aiSuppressed, aiConnectionStatus, setAiConnectionStatus,
    aiConnectionMessage, setAiConnectionMessage, aiOllamaHelp, setAiOllamaHelp,
  } = useFeaturesCtx();
  // AI sub-features can only be switched on once the provider can be called.
  const aiReady = aiHasCredentials(aiConfig);
  // The live model list fetch (see the model selector below).
  const [aiModelsStatus, setAiModelsStatus] = useState(null);
  const [aiModelsMessage, setAiModelsMessage] = useState('');

  return {
    ai: {
      show: !aiSuppressed,
      card: true,
      node: (
        <>
            {/* AI Features Section — hidden on the China App Store storefront
                to comply with App Store Review Guideline 5 (Deep Synthesis / MIIT). */}
            {!aiSuppressed && (<>

            {/* Off hides the provider, key and model; they are kept, so
                switching AI back on resumes with the same configuration. */}
            <SettingsCard
              cardId="ai"
              icon={BrainCircuit}
              title={t('settings.aiFeatures')}
              hint={t('settings.aiByoApiKey')}
              switchLabel={t('settings.enableAIFeatures')}
              checked={aiConfig.enabled}
              onToggle={(next) => {
                if (next) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true }));
                setAiConfig(prev => ({ ...prev, enabled: next }));
              }}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
                <div className="space-y-3">
                  {/* Provider selector */}
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.aiProvider')}</label>
                    <select
                      value={aiConfig.provider}
                      onChange={(e) => {
                        const provider = e.target.value;
                        const models = PROVIDER_MODELS[provider] || [];
                        setAiConfig(prev => ({
                          ...prev,
                          provider,
                          model: models[0]?.id || prev.model,
                          baseUrl: provider === 'ollama' ? (prev.baseUrl || 'http://localhost:11434') : provider === 'custom' ? prev.baseUrl : '',
                        }));
                        setAiConnectionStatus(null);
                        setAiOllamaHelp(null);
                      }}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    >
                      {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {key === 'ollama'
                            ? t('settings.aiProviderOllama', { defaultValue: 'Ollama (Local)' })
                            : key === 'custom'
                              ? t('settings.aiProviderCustom', { defaultValue: 'Custom (OpenAI-compatible)' })
                              : label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* API Key */}
                  {aiConfig.provider !== 'ollama' && (
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>
                        <Key size={12} className="inline mr-1" />
                        {t('settings.aiApiKey')}
                      </label>
                      <input
                        type="password"
                        placeholder={aiConfig.provider === 'openai' ? 'sk-...' : aiConfig.provider === 'anthropic' ? 'sk-ant-...' : t('settings.aiApiKey')}
                        value={aiConfig.apiKey}
                        onChange={(e) => {
                          setAiConfig(prev => ({ ...prev, apiKey: e.target.value }));
                          setAiConnectionStatus(null);
                        setAiOllamaHelp(null);
                        }}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm font-mono`}
                      />
                      <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.aiApiKeyHint')}</p>
                    </div>
                  )}

                  {/* Base URL for Ollama/Custom */}
                  {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>
                        <Server size={12} className="inline mr-1" />
                        {aiConfig.provider === 'ollama'
                          ? t('settings.aiOllamaUrl', { defaultValue: 'Ollama URL' })
                          : t('settings.aiBaseUrl', { defaultValue: 'Base URL' })}
                      </label>
                      <input
                        type="url"
                        placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'https://your-endpoint.com/v1'}
                        value={aiConfig.baseUrl}
                        onChange={(e) => setAiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                      {aiConfig.provider === 'custom' && (
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          {t('settings.aiCommonProviders', { defaultValue: 'Common providers:' })} Groq → <code className="font-mono">https://api.groq.com/openai/v1</code> · Together AI → <code className="font-mono">https://api.together.xyz/v1</code> · LM Studio → <code className="font-mono">http://localhost:1234/v1</code>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Model selector. The built-in list is a starting
                      point: a provider's ids retire (the 2026-10-03
                      Gemini report), so the list can be refreshed from
                      the provider and any id can be typed. A model not
                      in the list shows as "Other" with the id editable. */}
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.aiModel')}</label>
                    {(() => {
                      const listed = (aiConfig.modelLists?.[aiConfig.provider]?.length ? aiConfig.modelLists[aiConfig.provider] : PROVIDER_MODELS[aiConfig.provider]) || [];
                      const inList = listed.some((m) => m.id === aiConfig.model);
                      return (
                        <div className="space-y-2">
                          {listed.length > 0 && (
                            <select
                              data-ai-model-select
                              value={inList ? aiConfig.model : '__other__'}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAiConfig(prev => ({ ...prev, model: v === '__other__' ? '' : v }));
                              }}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            >
                              {listed.map(m => (
                                <option key={m.id} value={m.id}>{m.label}{m.recommended ? ` (${t('settings.aiRecommended', { defaultValue: 'Recommended' })})` : ''}</option>
                              ))}
                              <option value="__other__">{t('settings.aiModelOther', { defaultValue: 'Other (type a model id)' })}</option>
                            </select>
                          )}
                          {(!inList || listed.length === 0) && (
                            <input
                              type="text"
                              data-ai-model-input
                              placeholder={t('settings.aiModelPlaceholder', { defaultValue: 'Model name' })}
                              value={aiConfig.model}
                              onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            />
                          )}
                          {(
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                data-ai-fetch-models
                                disabled={aiModelsStatus === 'loading'}
                                onClick={async () => {
                                  setAiModelsStatus('loading');
                                  setAiModelsMessage('');
                                  try {
                                    const models = await fetchProviderModels(aiConfig);
                                    setAiConfig(prev => ({ ...prev, modelLists: { ...(prev.modelLists || {}), [prev.provider]: models } }));
                                    setAiModelsStatus('ok');
                                    setAiModelsMessage(t('settings.aiFetchModelsOk', { defaultValue: '{{count}} models available', count: models.length }));
                                  } catch (err) {
                                    setAiModelsStatus('error');
                                    setAiModelsMessage(t('settings.aiFetchModelsFailed', { defaultValue: 'Could not fetch models: {{error}}', error: err?.message || String(err) }));
                                  }
                                }}
                                className={`px-3 py-1.5 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-xs transition-colors disabled:opacity-50`}
                              >
                                {t('settings.aiFetchModels', { defaultValue: 'Fetch model list' })}
                              </button>
                              {aiModelsMessage && (
                                <span className={`text-xs ${aiModelsStatus === 'error' ? 'text-red-500' : textSecondary}`}>{aiModelsMessage}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Test Connection */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setAiConnectionStatus('testing');
                          setAiConnectionMessage('');
                          setAiOllamaHelp(null);
                          const result = await testConnection(aiConfig);
                          setAiConnectionStatus(result.success ? 'success' : 'error');
                          setAiConnectionMessage(result.message);
                          setAiOllamaHelp(result.ollamaHelp || null);
                        }}
                        disabled={aiConnectionStatus === 'testing'}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
                      >
                        {aiConnectionStatus === 'testing' ? (
                          <Loader size={14} className="animate-spin" />
                        ) : aiConnectionStatus === 'success' ? (
                          <Wifi size={14} />
                        ) : aiConnectionStatus === 'error' ? (
                          <WifiOff size={14} />
                        ) : (
                          <Wifi size={14} />
                        )}
                        {aiConnectionStatus === 'testing' ? t('settings.aiTesting') : t('settings.aiTestConnection')}
                      </button>
                      {aiConnectionStatus === 'success' && (
                        <span className="text-xs text-green-500">{t('settings.aiConnected')}</span>
                      )}
                      {aiConnectionStatus === 'error' && !aiOllamaHelp && (
                        <span className="text-xs text-red-500 truncate max-w-[180px]" title={aiConnectionMessage}>{aiConnectionMessage}</span>
                      )}
                    </div>
                    {aiOllamaHelp && (
                      <div className={`text-xs p-3 rounded-lg ${darkMode ? 'bg-red-900/30 border border-red-800/50' : 'bg-red-50 border border-red-200'}`}>
                        <p className="text-red-500 font-medium mb-1.5">{t('settings.aiOllamaConnectionError', { defaultValue: "Could not reach Ollama. Make sure it's running and CORS is enabled for this origin. See setup guide →" })}</p>
                        <ul className={`${textSecondary} space-y-1 ml-3 list-disc mb-2`}>
                          <li>{t('settings.aiOllamaRunning', { defaultValue: 'Ollama must be running on your computer' })}</li>
                          <li>{t('settings.aiOllamaCors', { defaultValue: "CORS must be enabled for this site's origin" })}</li>
                          <li>{t('settings.aiOllamaSetEnv', { defaultValue: 'Set:' })} <code className={`text-xs px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>OLLAMA_ORIGINS={window.electronAPI?.isElectron ? '*' : window.location.origin}</code></li>
                        </ul>
                        <a
                          href="https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-500 hover:text-purple-400 underline flex items-center gap-1 w-fit"
                        >
                          {t('settings.aiOllamaSetupGuide', { defaultValue: 'Ollama setup guide' })} <ExternalLink size={11} />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Per-feature toggles */}
                  <div className="space-y-2 mt-2">
                    <p className={`text-xs font-medium ${textSecondary}`}>{t('settings.aiFeaturesList')}</p>
                    {!aiReady && <p className="text-xs text-amber-500" data-ai-needs-key>{t('settings.aiNeedsKey')}</p>}
                    {[
                      { key: 'voiceTaskInput', label: t('settings.aiVoiceTaskInput'), icon: <Mic size={12} /> },
                      { key: 'morningSummary', label: t('settings.aiMorningSummary'), icon: <Sun size={12} /> },
                      { key: 'eveningReflection', label: t('settings.aiEveningReflection'), icon: <Moon size={12} /> },
                      { key: 'durationEstimate', label: t('settings.aiDurationEstimates'), icon: <Sparkles size={12} /> },
                      { key: 'frameNudge', label: t('settings.aiFrameNudges'), icon: <Zap size={12} /> },
                      { key: 'aiReschedule', label: t('settings.aiReschedule'), icon: <CalendarDays size={12} /> },
                      { key: 'aiSubtasks', label: t('settings.aiSubtasks'), icon: <CheckSquare size={12} /> },
                      { key: 'weeklySummary', label: t('settings.aiWeeklySummary'), icon: <BarChart3 size={12} /> },
                      { key: 'smartScheduling', label: t('settings.aiSmartScheduling'), icon: <CalendarDays size={12} /> },
                    ].map(f => (
                      <label key={f.key} className={`flex items-center gap-2 ${f.comingSoon || !aiReady ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}>
                        <div className="relative flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={f.comingSoon || !aiReady ? false : aiConfig.features[f.key]}
                            onChange={(e) => {
                              if (f.comingSoon || !aiReady) return;
                              setAiConfig(prev => ({
                                ...prev,
                                features: { ...prev.features, [f.key]: e.target.checked }
                              }));
                            }}
                            disabled={f.comingSoon || !aiReady}
                            className="sr-only"
                          />
                          <div className={`w-8 h-4 rounded-full transition-colors ${aiReady && !f.comingSoon && aiConfig.features[f.key] ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${aiReady && !f.comingSoon && aiConfig.features[f.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </div>
                        </div>
                        <span className={`text-xs ${textPrimary} flex items-center gap-1.5`}>
                          {f.icon} {f.label}
                          {f.comingSoon && <span className={`${textSecondary} italic`}>{t('common.comingSoon')}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
            </SettingsCard>
            </>)}
        </>
      ),
    },
  };
}
