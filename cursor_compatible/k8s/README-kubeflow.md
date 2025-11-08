# Kubeflow Production Deployment Guide

This guide describes how to deploy Kubeflow on your Kubernetes cluster in a secure, production-ready manner.

## 1. Namespace Isolation

Apply the provided namespace manifest:

```sh
kubectl apply -f kubeflow-namespace.yaml
```

## 2. Deploy Kubeflow (Recommended: Official Manifests)

Kubeflow is best deployed using the official manifests or kustomize packages. See the [Kubeflow documentation](https://www.kubeflow.org/docs/distributions/official/)

**Example (using kustomize):**

```sh
kubectl apply -k "github.com/kubeflow/manifests?ref=v1.8.0" -n kubeflow
```

- Replace `v1.8.0` with the latest stable release as needed.
- All Kubeflow components will be deployed in the `kubeflow` namespace.

## 3. RBAC and Security

- Kubeflow's official manifests include RBAC for all components.
- Review and restrict RBAC roles as needed for your environment.
- Apply network policies to restrict traffic to/from the `kubeflow` namespace.

## 4. Resource Requests and Limits

- After deployment, edit the resource requests/limits for each core component (e.g., pipelines, notebooks, training operators) to match your cluster's capacity and SLOs.
- Example:
  ```sh
  kubectl -n kubeflow edit deployment <component-name>
  ```

## 5. Secure Dashboard Exposure

- Expose the Kubeflow dashboard via Ingress with authentication (e.g., OIDC, OAuth2 proxy, or SSO provider).
- Example Ingress (placeholder):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kubeflow-dashboard
  namespace: kubeflow
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "https://your-auth-provider/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://your-auth-provider/oauth2/start?rd=$request_uri"
spec:
  rules:
    - host: kubeflow.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: istio-ingressgateway
                port:
                  number: 80
```
- Replace with your actual domain and authentication provider.

## 6. Post-Deployment Checklist

- [ ] All Kubeflow pods are running in the `kubeflow` namespace
- [ ] Dashboard is accessible only via authenticated ingress
- [ ] RBAC and network policies are in place
- [ ] Resource limits are set for all deployments
- [ ] Monitoring and logging are enabled for all Kubeflow components

## References
- [Kubeflow Official Docs](https://www.kubeflow.org/docs/)
- [Kubeflow Manifests GitHub](https://github.com/kubeflow/manifests)
- [Production Security Best Practices](https://www.kubeflow.org/docs/distributions/official/security/) 