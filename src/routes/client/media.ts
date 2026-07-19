import { Router } from "express";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { validateRequest } from "@/middlewares/shared/validation";
import { mediaSchemaValidation } from "@/validations/mediaValidation";
import { authenticate } from "@/middlewares/client/auth";
import { ImageKitService } from "@/services/core/ImagekitService";

const router = Router();
const imagekitService = new ImageKitService();

// router.use(authenticate); // usman said it is not needed

router.get(
  "/signatureWithDetails",
  validateRequest(mediaSchemaValidation),
  async (req, res) => {
    try {
      const { folder, fileName } = req.body;
      const signature =
        await imagekitService.generateUploadSignatureWithDetails(
          folder as string,
          fileName as string
        );
      res.status(200).json(signature);
    } catch (error) {
      sendErrorResponse(
        res,
        "Failed to generate signature",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }
  }
);

router.get("/signature", async (req, res) => {
  try {
    const signature = await imagekitService.generateUploadSignature();
    res.status(200).json(signature);
  } catch (error) {
    sendErrorResponse(
      res,
      "Failed to generate signature",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});

export default router;
