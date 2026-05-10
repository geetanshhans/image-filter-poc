// RTK Query slice for all server state. We define endpoints here once and the
// generated hooks are used throughout the UI. RTK Query handles caching,
// invalidation, polling, and request deduplication for us.

import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  ApiError,
  BatchUploadRequest,
  BatchUploadResponse,
  CompleteUploadResponse,
  DeleteImageResponse,
  HealthResponse,
  ImageDto,
  ImageStatus,
  ListImagesResponse,
} from "@argon/shared";
import { env } from "../config/env";

// One tag per resource. Mutations invalidate the relevant tag and any list
// query subscribed to it refetches automatically.
const TAG_IMAGES = "Images" as const;

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: `${env.apiUrl}/api`,
  }),
  tagTypes: [TAG_IMAGES],
  endpoints: (builder) => ({
    listImages: builder.query<ListImagesResponse, { status?: ImageStatus; ids?: string[] } | void>({
      query: (arg) => {
        const params = new URLSearchParams();
        if (arg && "status" in arg && arg.status) params.set("status", arg.status);
        if (arg && "ids" in arg && arg.ids?.length) params.set("ids", arg.ids.join(","));
        params.set("limit", "100");
        return `images?${params.toString()}`;
      },
      // Tag every image individually plus a list-level tag. Lets a single
      // image update invalidate just that image's caches.
      providesTags: (result) =>
        result
          ? [
              ...result.images.map((img: ImageDto) => ({ type: TAG_IMAGES as const, id: img.id })),
              { type: TAG_IMAGES as const, id: "LIST" },
            ]
          : [{ type: TAG_IMAGES as const, id: "LIST" }],
    }),

    createBatchUpload: builder.mutation<BatchUploadResponse, BatchUploadRequest>({
      query: (body) => ({
        url: "uploads/batch",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: TAG_IMAGES, id: "LIST" }],
    }),

    completeUpload: builder.mutation<CompleteUploadResponse, { imageId: string }>({
      query: ({ imageId }) => ({
        url: `uploads/${imageId}/complete`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: TAG_IMAGES, id: arg.imageId },
        { type: TAG_IMAGES, id: "LIST" },
      ],
    }),

    deleteImage: builder.mutation<DeleteImageResponse, { imageId: string }>({
      query: ({ imageId }) => ({
        url: `images/${imageId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: TAG_IMAGES, id: arg.imageId },
        { type: TAG_IMAGES, id: "LIST" },
      ],
    }),

    // Deep health probe. The /health page subscribes to this with polling
    // so it auto-refreshes; refetchOnMountOrArgChange keeps it lively
    // without us having to manage a timer manually.
    health: builder.query<HealthResponse, void>({
      query: () => "health",
    }),
  }),
});

export const {
  useListImagesQuery,
  useCreateBatchUploadMutation,
  useCompleteUploadMutation,
  useDeleteImageMutation,
  useHealthQuery,
} = api;

// Re-export the API slice's util for cache patching from outside React (we use
// this to patch the cache in response to WebSocket events).
export const apiUtil = api.util;

// Helper used by ApiError handling code on the frontend. Server always returns
// this shape on non-2xx responses.
export type ServerError = ApiError;
