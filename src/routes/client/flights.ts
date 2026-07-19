import { Router } from 'express';
import { FlightBookingController } from '@/controllers/client/FlightBookingController';

import { authenticate } from '@/middlewares/client/auth';
import { validateRequest, validateQuery } from '@/middlewares/shared/validation';
import { searchFlightsSchema, createFlightBookingSchema, flightBookingQuerySchema } from '@/validations/client/flightValidation';

const router = Router();

const flightBookingController = new FlightBookingController();

router.use(authenticate);
router.get('/search', validateQuery(searchFlightsSchema), flightBookingController.searchFlights);
router.post('/book', validateRequest(createFlightBookingSchema), flightBookingController.createFlightBooking);
// router.get('/', validateQuery(flightBookingQuerySchema), flightBookingController.getFlightBookings);
// router.get('/:bookingId', flightBookingController.getFlightBookingById);
// router.get('/reference/:reference', flightBookingController.getFlightBookingByReference);
router.post('/:bookingId/cancel', flightBookingController.cancelFlightBooking);

export default router;
