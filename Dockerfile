# Verified against https://docs.aws.amazon.com/lambda/latest/dg/python-image.html
# on 2026-09-13. The AWS base images ship the runtime interface client and the
# runtime interface emulator, so no RIE is installed here and local invocation
# goes straight to the /2015-03-31/functions/function/invocations endpoint.
#
# Build:  docker buildx build --platform linux/amd64 --provenance=false -t fdeprep-runner:dev .
# Run:    docker run --platform linux/amd64 -p 9000:8080 fdeprep-runner:dev
# Invoke: curl "http://localhost:9000/2015-03-31/functions/function/invocations" -d @event.json
FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# The secret mount is optional and absent in normal builds, where this is a
# plain pip install. It exists so the image can also be built behind a proxy
# that re-terminates TLS, by passing that proxy's CA bundle:
#   docker buildx build --secret id=ca_bundle,src=/path/to/ca-bundle.crt ...
# The bundle is never written into a layer.
RUN --mount=type=secret,id=ca_bundle \
    if [ -f /run/secrets/ca_bundle ]; then export PIP_CERT=/run/secrets/ca_bundle; fi; \
    pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY runner/ ${LAMBDA_TASK_ROOT}/runner/

# The runner spawns one sandbox process per case and both halves must resolve
# the same package. LAMBDA_TASK_ROOT is first on the search path already; this
# makes it explicit for the child process too.
ENV PYTHONPATH="${LAMBDA_TASK_ROOT}"
ENV PYTHONDONTWRITEBYTECODE=1

# No USER instruction on purpose: Lambda defines a least-privileged user itself.
CMD [ "runner.handler.lambda_handler" ]
