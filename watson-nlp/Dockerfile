# watson-nlp/Dockerfile
ARG RUNTIME="cp.icr.io/cp/ai/watson-nlp-runtime:1.1.36"
ARG EMOTION_MODEL="cp.icr.io/cp/ai/watson-nlp_emotion_aggregated-workflow_lang_en_stock:1.4.1"

FROM ${EMOTION_MODEL} as model
RUN ./unpack_model.sh

FROM ${RUNTIME}
ENV ACCEPT_LICENSE=true
ENV LOCAL_MODELS_DIR=/app/models
COPY --from=model /app/models/ /app/models/
EXPOSE 8080
